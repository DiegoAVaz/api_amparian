import assert from "node:assert/strict";
import { test } from "node:test";
// Pelo barrel, como em azure-storage.test.ts: confere também os reexports.
import {
  AzureDocumentStorage,
  buildCertificateKey,
} from "../../src/services/storage";
import { assertHttpError } from "../helpers";

// Testes offline: o `ContainerClient` do SDK é trocado por um falso que só
// registra as chamadas. O caminho real (Azure de verdade) é conferido à parte,
// com a connection string do .env local, fora da suíte de testes.

const PDF = Buffer.from("%PDF-1.7\n% conteúdo de teste\n");
const KEY = "certificates/7/0b8f6c1e-1d1a-4f0e-9a51-2a3b4c5d6e7f.pdf";

type Call = { op: string; key?: string; options?: unknown };

function fakeClient(
  opts: {
    publicAccess?: "blob" | "container";
    propertiesError?: Error;
    download?: () => Promise<Buffer>;
  } = {},
) {
  const calls: Call[] = [];
  let propertiesFailures = opts.propertiesError ? 1 : 0;

  const client = {
    getProperties: async () => {
      calls.push({ op: "getProperties" });
      if (propertiesFailures > 0) {
        propertiesFailures -= 1;
        throw opts.propertiesError;
      }
      return { blobPublicAccess: opts.publicAccess };
    },
    getBlockBlobClient: (key: string) => ({
      uploadData: async (_buffer: Buffer, options: unknown) => {
        calls.push({ op: "upload", key, options });
        return {};
      },
      downloadToBuffer: async () => {
        calls.push({ op: "download", key });
        return opts.download ? opts.download() : PDF;
      },
      deleteIfExists: async () => {
        calls.push({ op: "delete", key });
        return { succeeded: true };
      },
    }),
  };

  const storage = new AzureDocumentStorage(
    { connectionString: "não usada", container: "amparian-certificados" },
    client as never,
  );
  return { storage, calls };
}

// Formato real do `RestError` num 404 do `downloadToBuffer`, conferido contra o
// Azure: a operação começa com um HEAD, que não tem corpo, então `code` vem
// vazio e o código do Azure só aparece em `details.errorCode`.
function headRestError(errorCode: string) {
  return Object.assign(new Error(""), {
    name: "RestError",
    statusCode: 404,
    code: undefined,
    details: { errorCode },
  });
}

// Formato de um 404 com corpo (GET), em que o SDK preenche `code`.
function bodyRestError(code: string) {
  return Object.assign(new Error(code), { statusCode: 404, code });
}

test("buildCertificateKey puts the PDF under the owner's folder with a random name", () => {
  const key = buildCertificateKey(42);
  assert.match(
    key,
    /^certificates\/42\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
  );
  assert.notEqual(buildCertificateKey(42), key);
});

test("buildCertificateKey refuses an owner id that is not a positive integer", async () => {
  for (const id of [0, -1, 1.5, Number.NaN]) {
    await assertHttpError(async () => buildCertificateKey(id), {
      status: 500,
      code: "INVALID_STORAGE_KEY",
    });
  }
});

test("put uploads as a private, uncached PDF and never overwrites", async () => {
  const { storage, calls } = fakeClient();

  const stored = await storage.put(KEY, {
    buffer: PDF,
    contentType: "application/pdf",
  });

  assert.deepEqual(stored, {
    key: KEY,
    contentType: "application/pdf",
    size: PDF.byteLength,
  });
  const upload = calls.find((call) => call.op === "upload");
  assert.equal(upload?.key, KEY);
  assert.deepEqual(upload?.options, {
    blobHTTPHeaders: {
      blobContentType: "application/pdf",
      blobCacheControl: "private, no-store",
    },
    conditions: { ifNoneMatch: "*" },
  });
});

test("put refuses a buffer that is not a PDF before touching Azure", async () => {
  const { storage, calls } = fakeClient();

  for (const buffer of [
    Buffer.alloc(0),
    Buffer.from("%PD"),
    Buffer.from("<html>erro</html>"),
  ]) {
    await assertHttpError(
      () => storage.put(KEY, { buffer, contentType: "application/pdf" }),
      { status: 500, code: "INVALID_DOCUMENT" },
    );
  }
  assert.deepEqual(calls, []);
});

test("every operation refuses an unsafe key before touching Azure", async () => {
  const { storage, calls } = fakeClient();
  const unsafe = "certificates/../users/7/avatar.png";

  await assertHttpError(
    () => storage.put(unsafe, { buffer: PDF, contentType: "application/pdf" }),
    { status: 500, code: "INVALID_STORAGE_KEY" },
  );
  await assertHttpError(() => storage.get(unsafe), {
    status: 500,
    code: "INVALID_STORAGE_KEY",
  });
  await assertHttpError(() => storage.delete(unsafe), {
    status: 500,
    code: "INVALID_STORAGE_KEY",
  });
  assert.deepEqual(calls, []);
});

test("get returns the stored bytes", async () => {
  const { storage } = fakeClient();
  assert.deepEqual(await storage.get(KEY), PDF);
});

for (const [shape, error] of [
  ["HEAD (code only in details)", headRestError("BlobNotFound")],
  ["GET (code on the error)", bodyRestError("BlobNotFound")],
] as const) {
  test(`get returns null when the blob is gone, so the caller can regenerate it — ${shape}`, async () => {
    const { storage } = fakeClient({
      download: async () => {
        throw error;
      },
    });
    assert.equal(await storage.get(KEY), null);
  });
}

for (const [shape, error] of [
  ["HEAD (code only in details)", headRestError("ContainerNotFound")],
  ["GET (code on the error)", bodyRestError("ContainerNotFound")],
] as const) {
  test(`get rethrows a missing container instead of pretending the blob is gone — ${shape}`, async () => {
    const { storage } = fakeClient({
      download: async () => {
        throw error;
      },
    });
    await assert.rejects(() => storage.get(KEY), error);
  });
}

test("get rethrows a non-404 failure even if it names BlobNotFound", async () => {
  const error = Object.assign(new Error("forbidden"), {
    statusCode: 403,
    code: "BlobNotFound",
  });
  const { storage } = fakeClient({
    download: async () => {
      throw error;
    },
  });
  await assert.rejects(() => storage.get(KEY), error);
});

test("delete removes the blob", async () => {
  const { storage, calls } = fakeClient();
  await storage.delete(KEY);
  assert.ok(calls.some((call) => call.op === "delete" && call.key === KEY));
});

// Regressão de segurança: o env.ts só compara nomes. Um container de
// certificados com leitura anônima precisa ser recusado pelo próprio adaptador.
for (const publicAccess of ["blob", "container"] as const) {
  test(`refuses to read or write when the container allows anonymous ${publicAccess} access`, async () => {
    const { storage, calls } = fakeClient({ publicAccess });

    await assertHttpError(
      () => storage.put(KEY, { buffer: PDF, contentType: "application/pdf" }),
      { status: 500, code: "DOCUMENT_STORAGE_NOT_PRIVATE" },
    );
    await assertHttpError(() => storage.get(KEY), {
      status: 500,
      code: "DOCUMENT_STORAGE_NOT_PRIVATE",
    });
    await assertHttpError(() => storage.delete(KEY), {
      status: 500,
      code: "DOCUMENT_STORAGE_NOT_PRIVATE",
    });

    assert.deepEqual(
      calls.map((call) => call.op),
      ["getProperties"],
      "a recusa fica guardada e nada foi gravado, lido nem apagado",
    );
  });
}

test("checks the access level once per instance, not on every operation", async () => {
  const { storage, calls } = fakeClient();

  await storage.put(KEY, { buffer: PDF, contentType: "application/pdf" });
  await storage.get(KEY);
  await storage.delete(KEY);

  assert.equal(calls.filter((call) => call.op === "getProperties").length, 1);
});

test("a failed access check is retried on the next operation, not cached", async () => {
  const networkError = new Error("ECONNRESET");
  const { storage, calls } = fakeClient({ propertiesError: networkError });

  await assert.rejects(() => storage.get(KEY), networkError);
  assert.deepEqual(await storage.get(KEY), PDF);
  assert.equal(calls.filter((call) => call.op === "getProperties").length, 2);
});
