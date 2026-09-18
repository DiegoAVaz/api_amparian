import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPublicUrlResolver,
  storageKeyOf,
} from "../../src/services/storage";
import type { Storage } from "../../src/services/storage";

/** Storage falso: só `publicUrl` importa aqui, e pode ser instruído a falhar. */
function fakeStorage(aoMontar?: () => never): Storage {
  return {
    put: async () => {
      throw new Error("não deveria ser chamado");
    },
    delete: async () => {
      throw new Error("não deveria ser chamado");
    },
    publicUrl: (key: string) => {
      if (aoMontar) aoMontar();
      return `https://conta.blob.core.windows.net/amparian/${key}`;
    },
  };
}

test("uma chave de blob vira URL pelo storage", () => {
  const resolve = createPublicUrlResolver(fakeStorage());
  assert.equal(
    resolve("events/12/cover-abc.png"),
    "https://conta.blob.core.windows.net/amparian/events/12/cover-abc.png",
  );
});

test("nulo continua nulo, sem chamar o storage", () => {
  const resolve = createPublicUrlResolver(
    fakeStorage(() => {
      throw new Error("o storage não podia ter sido chamado");
    }),
  );
  assert.equal(resolve(null), null);
});

// A coluna foi reaproveitada, então ainda pode conter uma URL colada antes do
// upload existir. Sem esta passagem, uma linha antiga viraria 500: `https://...`
// não passa em `assertSafeStorageKey`.
test("uma URL externa legada é devolvida como está", () => {
  const resolve = createPublicUrlResolver(
    fakeStorage(() => {
      throw new Error("o storage não podia ter sido chamado para URL legada");
    }),
  );
  assert.equal(
    resolve("https://example.com/foto.png"),
    "https://example.com/foto.png",
  );
  assert.equal(resolve("http://example.com/foto.png"), "http://example.com/foto.png");
});

// Uma linha corrompida não pode derrubar a listagem inteira de eventos: o card
// perde a imagem, o resto da tela continua de pé.
//
// O erro precisa ter `code`, e não só a mensagem: o resolvedor ramifica em
// `error.code` para separar linha ruim de configuração ruim. Um `new Error`
// comum cairia no ramo errado e deixaria o outro sem cobertura nenhuma.
test("uma chave inválida vira null em vez de estourar a listagem", () => {
  const resolve = createPublicUrlResolver(
    fakeStorage(() => {
      throw Object.assign(new Error("chave inválida"), {
        code: "INVALID_STORAGE_KEY",
      });
    }),
  );
  assert.equal(resolve("chave/../invalida"), null);
});

// O outro ramo: connection string malformada apaga TODA imagem do site, e não
// pode se esconder entre avisos de linha isolada.
test("uma falha que não é de chave também vira null, pelo outro ramo", () => {
  const resolve = createPublicUrlResolver(
    fakeStorage(() => {
      throw new Error("Invalid BlobEndpoint in the provided connection string");
    }),
  );
  assert.equal(resolve("events/1/cover-abc.png"), null);
});

test("storageKeyOf separa chave de blob de URL legada", () => {
  assert.equal(storageKeyOf("events/12/cover-abc.png"), "events/12/cover-abc.png");
  assert.equal(storageKeyOf(null), null);
  // O ponto do helper: URL externa não é chave, e devolvê-la como `imageKey`
  // faria o resto do sistema achar que existe um blob apagável ali.
  assert.equal(storageKeyOf("https://example.com/foto.png"), null);
  assert.equal(storageKeyOf("http://example.com/foto.png"), null);
});
