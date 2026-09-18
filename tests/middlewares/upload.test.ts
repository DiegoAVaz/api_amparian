import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { MulterError } from "multer";
import { errorHandler } from "../../src/middlewares/error-handler";
import {
  createUploadImage,
  toUploadHttpError,
  UPLOAD_FIELD_NAME,
} from "../../src/middlewares/upload";
import { validateImage } from "../../src/services/storage/image-validation";
import { HttpError } from "../../src/utils/http-error";

const MAX = 4_000_000;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function traduzir(codigo: ConstructorParameters<typeof MulterError>[0]) {
  const resultado = toUploadHttpError(new MulterError(codigo), MAX);
  assert.ok(
    resultado instanceof HttpError,
    `${codigo} deveria virar HttpError, veio ${String(resultado)}`,
  );
  return resultado;
}

// ---------------------------------------------------------------- tradutor

test("file above the limit becomes 413, not a generic 500", () => {
  const erro = traduzir("LIMIT_FILE_SIZE");
  assert.equal(erro.status, 413);
  assert.equal(erro.code, "FILE_TOO_LARGE");
});

// O limite é cobrado duas vezes — aqui durante o parse, e no buffer por
// `validateImage`. Duas mensagens diferentes para a mesma regra leriam como
// duas regras diferentes, então elas têm que coincidir literalmente.
test("the 413 message is identical to the one validateImage produces", () => {
  const doMiddleware = traduzir("LIMIT_FILE_SIZE").message;

  let doValidateImage = "";
  try {
    validateImage(Buffer.alloc(MAX + 1), MAX);
  } catch (erro) {
    doValidateImage = (erro as HttpError).message;
  }

  assert.equal(doMiddleware, doValidateImage);
});

test("a file in an unexpected field names the field the route expects", () => {
  const erro = traduzir("LIMIT_UNEXPECTED_FILE");
  assert.equal(erro.status, 400);
  assert.equal(erro.code, "UNEXPECTED_FILE");
  assert.match(erro.message, new RegExp(`"${UPLOAD_FIELD_NAME}"`));
});

test("extra files, parts or fields all collapse into one 400", () => {
  for (const codigo of [
    "LIMIT_FILE_COUNT",
    "LIMIT_PART_COUNT",
    "LIMIT_FIELD_COUNT",
  ] as const) {
    const erro = traduzir(codigo);
    assert.equal(erro.status, 400, codigo);
    assert.equal(erro.code, "TOO_MANY_PARTS", codigo);
    assert.deepEqual(erro.details, { context: { limit: codigo } });
  }
});

test("an unmapped multer code still becomes a 400, never a 500", () => {
  const erro = traduzir("LIMIT_FIELD_KEY");
  assert.equal(erro.status, 400);
  assert.equal(erro.code, "INVALID_UPLOAD");
});

// `toUploadHttpError` é puro e não decide o destino do que não é MulterError —
// achatar tudo aqui apagaria o status de um erro vindo de outro ponto.
test("anything that is not a MulterError passes through the translator untouched", () => {
  const naoMulter = new HttpError(403, "FORBIDDEN", "Sem permissão");
  assert.equal(toUploadHttpError(naoMulter, MAX), naoMulter);

  const generico = new Error("socket hang up");
  assert.equal(toUploadHttpError(generico, MAX), generico);

  assert.equal(toUploadHttpError(null, MAX), null);
});

// ------------------------------------------------------------- middleware

type Resposta = { status: number; corpo: unknown };
type EnvelopeErro = {
  error: { code: string; details: { context: { limit: string } } | null };
};

async function comServidor(
  acao: (
    postar: (body: BodyInit, headers?: HeadersInit) => Promise<Resposta>,
  ) => Promise<void>,
  maxBytes = MAX,
) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.post("/u", createUploadImage(maxBytes), (req, res) => {
    res.json({ bytes: req.file?.buffer.byteLength ?? null });
  });
  app.use(errorHandler);

  const servidor = app.listen(0);
  await new Promise<void>((ok) => servidor.once("listening", ok));
  const { port } = servidor.address() as { port: number };

  try {
    await acao(async (body, headers) => {
      const res = await fetch(`http://127.0.0.1:${port}/u`, {
        method: "POST",
        body,
        headers,
      });
      return { status: res.status, corpo: await res.json() };
    });
  } finally {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  }
}

function formComArquivo() {
  const form = new FormData();
  form.append(
    UPLOAD_FIELD_NAME,
    new Blob([new Uint8Array(PNG)], { type: "image/png" }),
    "foto.png",
  );
  return form;
}

// Regressão. Um `parts: 1` nestes limites recusava TODO upload legítimo, e
// nenhum teste sobre o tradutor conseguia enxergar: o request precisa existir
// de verdade.
test("the production limits accept a request carrying exactly one file", async () => {
  await comServidor(async (postar) => {
    const { status, corpo } = await postar(formComArquivo());
    assert.equal(
      status,
      200,
      `upload de um arquivo só foi recusado: ${JSON.stringify(corpo)}`,
    );
    assert.equal((corpo as { bytes?: number }).bytes, PNG.byteLength);
  });
});

// O 413 depende do aborto interno do multer, não só do código de erro — é a
// mesma classe do bug do `parts: 1`, onde o teste unitário fica verde enquanto
// o request real trava. Servidor com limite pequeno, arquivo acima dele.
test("a file over the limit answers 413 in a real request, not only in the translator", async () => {
  await comServidor(
    async (postar) => {
      const grande = new FormData();
      grande.append(
        UPLOAD_FIELD_NAME,
        new Blob([new Uint8Array(Buffer.alloc(3_000, 0x41))], {
          type: "image/png",
        }),
        "grande.png",
      );

      const { status, corpo } = await postar(grande);
      assert.equal(status, 413, `veio ${status}: ${JSON.stringify(corpo)}`);
      const erro = (corpo as EnvelopeErro).error;
      assert.equal(erro.code, "FILE_TOO_LARGE");
      assert.deepEqual(erro.details, { context: { limit: "LIMIT_FILE_SIZE" } });
    },
    2_000,
  );
});

// O caso que motivou o achado BLOCKING: multer sinaliza multipart malformado
// com `Error` simples, não `MulterError`. Sem tradução isso virava 500 com
// stack trace para um problema que é sempre do cliente — inclusive a conexão
// que cai no meio do upload de uma foto.
test("a multipart body with no boundary answers 400, not 500", async () => {
  await comServidor(async (postar) => {
    const { status, corpo } = await postar("nem parece multipart", {
      "content-type": "multipart/form-data",
    });
    assert.equal(status, 400, `veio ${status}: ${JSON.stringify(corpo)}`);
    const erro = (corpo as EnvelopeErro).error;
    assert.equal(erro.code, "INVALID_UPLOAD");
    // `details` é o ÚNICO sinal que distingue este caminho do `default:` do
    // tradutor, que devolve o mesmo par 400/INVALID_UPLOAD. Sem esta linha, o
    // teste continuaria verde se o tratamento de erro não-MulterError sumisse —
    // que é justamente o achado BLOCKING que ele existe para travar.
    assert.deepEqual(erro.details, {
      context: { limit: "MALFORMED_MULTIPART" },
    });
  });
});

// A mensagem do MISSING_FILE fala em multipart porque requisição que não é
// multipart cai aqui: o multer nem tenta parsear. Isso estava documentado e
// não verificado.
test("a request that is not multipart at all also answers 400 MISSING_FILE", async () => {
  await comServidor(async (postar) => {
    const { status, corpo } = await postar(JSON.stringify({ imagem: "base64" }), {
      "content-type": "application/json",
    });
    assert.equal(status, 400, `veio ${status}: ${JSON.stringify(corpo)}`);
    assert.equal((corpo as EnvelopeErro).error.code, "MISSING_FILE");
  });
});

test("a request with no file at all answers 400 MISSING_FILE", async () => {
  await comServidor(async (postar) => {
    const { status, corpo } = await postar(new FormData());
    assert.equal(status, 400);
    const erro = (corpo as EnvelopeErro).error;
    assert.equal(erro.code, "MISSING_FILE");
    // Toda resposta de upload carrega o mesmo formato de `details`, para o
    // cliente ler `details.context.limit` sem checar null antes.
    assert.deepEqual(erro.details, { context: { limit: "MISSING_FILE" } });
  });
});

// `fields: 0` é também uma restrição sobre o cliente: `new FormData(form)`
// serializa todo controle nomeado, então o front precisa montar o corpo à mão.
test("a text field alongside the file is refused, and details name the limit", async () => {
  await comServidor(async (postar) => {
    const form = formComArquivo();
    form.append("titulo", "campo a mais");

    const { status, corpo } = await postar(form);
    assert.equal(status, 400);
    const erro = (corpo as EnvelopeErro).error;
    assert.equal(erro.code, "TOO_MANY_PARTS");
    assert.deepEqual(erro.details, { context: { limit: "LIMIT_FIELD_COUNT" } });
  });
});
