import assert from "node:assert/strict";
import { test } from "node:test";
import type { ValidatedImage } from "../../src/services/storage/image-validation";
import {
  assertSafeStorageKey,
  buildAvatarKey,
  buildEventCoverKey,
  detectImage,
  validateImage,
} from "../../src/services/storage/image-validation";
import { assertHttpError } from "../helpers";

const MAX = 4_000_000;

function comCorpo(cabecalho: number[] | Buffer, resto = 32): Buffer {
  const inicio = Buffer.isBuffer(cabecalho) ? cabecalho : Buffer.from(cabecalho);
  return Buffer.concat([inicio, Buffer.alloc(resto, 0x00)]);
}

const JPEG = comCorpo([0xff, 0xd8, 0xff, 0xe0]);
const PNG = comCorpo([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = comCorpo(
  Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "ascii"),
  ]),
);
// Mesmo container RIFF do WebP, formato diferente no offset 8.
const WAV = comCorpo(
  Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from("WAVE", "ascii"),
  ]),
);

test("detectImage identifies the three accepted formats by their leading bytes", () => {
  assert.deepEqual(detectImage(JPEG), {
    contentType: "image/jpeg",
    extension: "jpg",
  });
  assert.deepEqual(detectImage(PNG), {
    contentType: "image/png",
    extension: "png",
  });
  assert.deepEqual(detectImage(WEBP), {
    contentType: "image/webp",
    extension: "webp",
  });
});

test("detectImage rejects a RIFF container that is not WebP", () => {
  assert.equal(detectImage(WAV), null);
});

test("detectImage rejects SVG, which has no binary signature", () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.equal(detectImage(svg), null);
});

test("detectImage survives a buffer shorter than the signatures", () => {
  assert.equal(detectImage(Buffer.alloc(0)), null);
  assert.equal(detectImage(Buffer.from([0xff, 0xd8])), null);
  // Curto o bastante para o RIFF casar e a leitura do offset 8 sair do fim.
  assert.equal(detectImage(Buffer.from("RIFF", "ascii")), null);
});

test("validateImage returns the type sniffed from the bytes, not the declared one", () => {
  assert.deepEqual(validateImage(PNG, MAX), {
    contentType: "image/png",
    extension: "png",
    buffer: PNG,
  });
});

// O ponto de devolver os bytes junto da evidência: não existe um segundo
// parâmetro de buffer para o chamador errar entre validar e gravar.
test("validateImage returns the very buffer it inspected", () => {
  const resultado = validateImage(PNG, MAX);
  assert.equal(resultado.buffer, PNG, "precisa ser a mesma referência");
});

// Asserção de tipo, não de runtime: o `@ts-expect-error` é o próprio teste. Se
// o brand for removido, a forja passa a compilar, o erro esperado deixa de
// existir e o `tsc` falha nesta linha. É o que impede um controller de escrever
// `{ contentType: req.file.mimetype, extension: "svg", buffer }` e reabrir o
// buraco do SVG pela única porta que o sniff existe para fechar.
test("ValidatedImage cannot be forged outside validateImage", () => {
  // @ts-expect-error o brand só pode ser afirmado por validateImage
  const forjado: ValidatedImage = {
    contentType: "image/svg+xml",
    extension: "svg",
    buffer: Buffer.from("<svg onload=alert(1)/>"),
  };
  assert.equal(forjado.contentType, "image/svg+xml");
});

test("validateImage rejects a text file renamed to .png with 415", async () => {
  const disfarcado = Buffer.from("<?php system($_GET['c']); ?>");
  await assertHttpError(async () => validateImage(disfarcado, MAX), {
    status: 415,
    code: "UNSUPPORTED_MEDIA_TYPE",
  });
});

test("validateImage rejects a buffer above the limit with 413", async () => {
  const grande = Buffer.concat([PNG, Buffer.alloc(200)]);
  await assertHttpError(async () => validateImage(grande, 100), {
    status: 413,
    code: "FILE_TOO_LARGE",
  });
});

test("validateImage rejects an empty file before sniffing", async () => {
  await assertHttpError(async () => validateImage(Buffer.alloc(0), MAX), {
    status: 400,
    code: "EMPTY_FILE",
  });
});

test("key builders take the extension from the signature, never from a filename", () => {
  const chave = buildAvatarKey(7, { contentType: "image/png", extension: "png" });
  assert.match(
    chave,
    /^users\/7\/avatar-[0-9a-f-]{36}\.png$/,
    `chave inesperada: ${chave}`,
  );

  const capa = buildEventCoverKey(12, {
    contentType: "image/webp",
    extension: "webp",
  });
  assert.match(capa, /^events\/12\/cover-[0-9a-f-]{36}\.webp$/);
});

test("key builders never repeat a key, which is what immutable caching rests on", () => {
  const png = { contentType: "image/png", extension: "png" };
  const chaves = new Set(
    Array.from({ length: 50 }, () => buildAvatarKey(7, png)),
  );
  assert.equal(chaves.size, 50);
});

test("key builders refuse an id that is not a positive integer", async () => {
  const png = { contentType: "image/png", extension: "png" };
  for (const id of [0, -1, 1.5, Number.NaN]) {
    await assertHttpError(async () => buildAvatarKey(id, png), {
      status: 500,
      code: "INVALID_STORAGE_KEY",
    });
  }
});

// Documenta uma limitação conhecida, em vez de deixá-la implícita: só os bytes
// iniciais são verificados. Um PNG válido seguido de qualquer coisa passa, é
// gravado como image/png e fica um ano em cache pelo `immutable`. Não é XSS
// aqui — o content-type é honesto e a origem do storage é separada — mas
// transforma o container em hospedagem de arquivo. Fechar de verdade exige
// reprocessar a imagem (`sharp`), que de quebra removeria o EXIF com GPS.
test("validateImage accepts a valid header followed by arbitrary bytes (known limitation)", () => {
  const carga = Buffer.concat([PNG, Buffer.from("PKconteudo-zip")]);
  assert.deepEqual(validateImage(carga, MAX), {
    contentType: "image/png",
    extension: "png",
    buffer: carga,
  });
});

test("validateImage rejects a missing buffer as 400 rather than crashing", async () => {
  await assertHttpError(
    async () => validateImage(undefined as unknown as Buffer, MAX),
    { status: 400, code: "EMPTY_FILE" },
  );
});

test("assertSafeStorageKey rejects every key the builders can never produce", async () => {
  for (const chave of [
    "events/../secret/x.png",
    "../x.png",
    "events/12/../../x.png",
    "events//x.png",
    "x.png",
    // Backslash e CRLF: o primeiro seria travessia no Windows, o segundo
    // injetaria cabeçalho na chamada REST do Azure.
    "events\\..\\secret.png",
    "events/12/x.png\r\nHost: outro",
    // Dimensionado ao teto real de 255, não ao 1024 do Azure: 264 caracteres
    // passariam num limite calibrado pelo SDK. É o único caso deste laço cuja
    // correção depende de um número, e por isso o mais provável de regredir.
    `events/12/${"a".repeat(250)}.png`,
    // Cabe em 255 caracteres e ainda assim tem 255 segmentos: quem recusa aqui
    // é o SAFE_SEGMENT, pelos segmentos vazios, não o limite de comprimento.
    `a${"/".repeat(254)}`,
  ]) {
    // O try/catch é o que faz a chave chegar na mensagem. `assertHttpError`
    // lança em toda falha, então qualquer asserção depois dele seria código
    // morto — e uma regressão diria só "esperava HttpError 500", sem apontar
    // qual das entradas parou de falhar.
    try {
      await assertHttpError(async () => assertSafeStorageKey(chave), {
        status: 500,
        code: "INVALID_STORAGE_KEY",
      });
    } catch (erro) {
      // "não rejeitada como esperado" e não "aceita": este catch também dispara
      // quando a chave FOI recusada, porém com outro status ou código.
      assert.fail(
        `chave não rejeitada como esperado: ${JSON.stringify(chave)} — ${
          (erro as Error).message
        }`,
      );
    }
  }
});

test("assertSafeStorageKey accepts the keys the builders produce", () => {
  const chave = "users/7/avatar-2f1c9a4e-0b3d-4e5f-8a1b-6c7d8e9f0a1b.jpg";
  assert.equal(assertSafeStorageKey(chave), chave);
});
