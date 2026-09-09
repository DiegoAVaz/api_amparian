import assert from "node:assert/strict";
import { test } from "node:test";
// Importa pelo barrel de propósito: além da classe, isso verifica que os
// reexports de `index.ts` continuam de pé.
import { AzureBlobStorage } from "../../src/services/storage";
import { assertHttpError } from "../helpers";

// Conta fictícia: `fromConnectionString` só faz parse, sem rede, então estes
// testes rodam offline e sem credencial real.
const CONNECTION_STRING =
  "DefaultEndpointsProtocol=https;AccountName=contateste;AccountKey=dGVzdGU=;EndpointSuffix=core.windows.net";

function storage(publicBaseUrl?: string) {
  return new AzureBlobStorage({
    connectionString: CONNECTION_STRING,
    container: "amparian",
    publicBaseUrl,
  });
}

test("publicUrl derives the base from the container when nothing overrides it", () => {
  assert.equal(
    storage().publicUrl("events/12/cover-abc.jpg"),
    "https://contateste.blob.core.windows.net/amparian/events/12/cover-abc.jpg",
  );
});

test("publicUrl prefers the configured base over the container URL", () => {
  assert.equal(
    storage("https://cdn.amparian.org").publicUrl("users/7/avatar-xyz.png"),
    "https://cdn.amparian.org/users/7/avatar-xyz.png",
  );
});

test("publicUrl strips trailing slashes so the key does not double the separator", () => {
  assert.equal(
    storage("https://cdn.amparian.org///").publicUrl("users/7/avatar.png"),
    "https://cdn.amparian.org/users/7/avatar.png",
  );
});

// Desde o stg-2 `publicUrl` valida a chave, então caractere fora de
// [A-Za-z0-9._-] não chega a ser codificado: é recusado antes. O encoding por
// segmento continua no código como segunda linha, mas nenhuma chave válida o
// exercita — o comportamento observável é a recusa.
test("publicUrl refuses a key with a character the builders can never produce", async () => {
  await assertHttpError(
    async () => storage().publicUrl("events/1/foto de capa.jpg"),
    { status: 500, code: "INVALID_STORAGE_KEY" },
  );
});

test("publicUrl refuses a traversal key instead of emitting a collapsing URL", async () => {
  await assertHttpError(
    async () => storage().publicUrl("events/../private/x.jpg"),
    { status: 500, code: "INVALID_STORAGE_KEY" },
  );
});

// Regressão de segurança. Com connection string de SAS — forma que o `env.ts`
// aceita — a URL do container montada pelo SDK carrega `?sig=...`. Usá-la crua
// colocava o token dentro de toda URL de imagem devolvida pelo `GET /events`,
// que é público. Em desenvolvimento não aparecia: chave de conta não tem query.
test("publicUrl never leaks the SAS signature from the connection string", () => {
  const comSas = new AzureBlobStorage({
    connectionString:
      "BlobEndpoint=https://contateste.blob.core.windows.net/;SharedAccessSignature=sv=2022-11-02&ss=b&sp=rwdlac&sig=SEGREDOxyz%3D",
    container: "amparian",
  });

  const url = comSas.publicUrl("events/1/cover-abc.png");

  assert.ok(!url.includes("sig="), `assinatura vazou na URL: ${url}`);
  assert.ok(!url.includes("?"), `query string sobreviveu na URL: ${url}`);
  assert.equal(
    url,
    "https://contateste.blob.core.windows.net/amparian/events/1/cover-abc.png",
  );
});
