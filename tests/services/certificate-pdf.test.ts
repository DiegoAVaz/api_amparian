import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  renderCertificatePdf,
  type CertificateDocumentData,
} from "../../src/services/certificates";
import { assertHttpError } from "../helpers";

function data(
  overrides: Partial<CertificateDocumentData> = {},
): CertificateDocumentData {
  return {
    participantName: "Maria Eduarda Santos",
    eventTitle: "Mutirão de Plantio no Parque da Cidade",
    organizerName: "Instituto Raízes Verdes",
    organizerPersonName: "João Pereira",
    eventStartsAt: new Date("2026-11-08T11:00:00Z"),
    eventEndsAt: new Date("2026-11-08T15:00:00Z"),
    eventLocationName: "Parque da Cidade — São Paulo/SP",
    eventIsRemote: false,
    workloadHours: 4,
    issuedAt: new Date("2026-11-10T15:00:00Z"),
    verificationCode: "7KQ2M9XP4TDA",
    appWebUrl: "https://amparian-front.vercel.app",
    ...overrides,
  };
}

test("renders a one-page A4 landscape PDF", async () => {
  const pdf = await renderCertificatePdf(data());

  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(
    Math.abs(width - 841.89) < 0.01 && Math.abs(height - 595.28) < 0.01,
  );
});

test("metadata names the participant and the event, dated at issuance", async () => {
  const doc = await PDFDocument.load(await renderCertificatePdf(data()), {
    updateMetadata: false,
  });

  assert.equal(
    doc.getTitle(),
    "Certificado de Participação — Maria Eduarda Santos",
  );
  assert.equal(doc.getSubject(), "Mutirão de Plantio no Parque da Cidade");
  assert.equal(doc.getAuthor(), "Amparian");
  assert.equal(
    doc.getCreationDate()?.toISOString(),
    "2026-11-10T15:00:00.000Z",
  );
  assert.ok(doc.getKeywords()?.includes("7KQ2-M9XP-4TDA"));
});

// RC-05: um PDF perdido é regenerado a partir do snapshot, e não pode sair diferente do original.
test("the same snapshot renders a byte-identical PDF", async () => {
  const first = await renderCertificatePdf(data());
  const second = await renderCertificatePdf(data());
  assert.ok(first.equals(second));
});

test("embeds only the glyphs it uses, keeping the file small", async () => {
  const pdf = await renderCertificatePdf(data());
  assert.ok(pdf.byteLength < 120_000, `PDF com ${pdf.byteLength} bytes`);
});

test("renders every text variant and extreme lengths without throwing", async () => {
  const long = (word: string) =>
    `${word} `.repeat(Math.floor(255 / (word.length + 1))).trim();
  const variants: Partial<CertificateDocumentData>[] = [
    { workloadHours: null, eventEndsAt: new Date("2026-11-10T21:00:00Z") },
    { eventEndsAt: null, workloadHours: null },
    { eventIsRemote: true, eventLocationName: null },
    { eventLocationName: null },
    { organizerName: "Carla Mendes", organizerPersonName: "Carla Mendes" },
    {
      participantName: long("Nome"),
      eventTitle: long("Título"),
      organizerName: long("Organização"),
      organizerPersonName: long("Pessoa"),
      eventLocationName: long("Local"),
      workloadHours: 499.99,
    },
    { eventTitle: "Supercalifragilisticexpialidocious".repeat(7) },
    // Pior caso: 255 caracteres sem nenhum espaço em todos os campos, em maiúsculas largas. A
    // renderização recusa (CERTIFICATE_LAYOUT_OVERFLOW) se o texto não couber acima do rodapé,
    // então gerar sem erro prova que coube.
    {
      participantName: "W".repeat(255),
      eventTitle: "M".repeat(255),
      organizerName: "W".repeat(255),
      organizerPersonName: "M".repeat(255),
      eventLocationName: "W".repeat(255),
      workloadHours: 499.99,
    },
  ];
  for (const variant of variants) {
    const doc = await PDFDocument.load(
      await renderCertificatePdf(data(variant)),
    );
    assert.equal(doc.getPageCount(), 1);
  }
});

test("characters the font lacks are dropped instead of printed as empty boxes", async () => {
  const doc = await PDFDocument.load(
    await renderCertificatePdf(data({ participantName: "Ana 🌱 Souza\n" })),
    { updateMetadata: false },
  );
  assert.equal(doc.getTitle(), "Certificado de Participação — Ana Souza");
});

test("a name that would lose a letter is refused, so the volunteer can fix it", async () => {
  for (const participantName of ["Kim 김민준", "محمد", "🌱🌱", "  "]) {
    await assertHttpError(
      () => renderCertificatePdf(data({ participantName })),
      { status: 422, code: "CERTIFICATE_NAME_UNPRINTABLE" },
    );
  }
});

test("accented, Greek and Cyrillic letters print fine", async () => {
  for (const participantName of [
    "João Conceição Müller Ñúñez",
    "Ζωή Παπαδοπούλου",
    "Анна Иванова",
  ]) {
    const doc = await PDFDocument.load(
      await renderCertificatePdf(data({ participantName })),
      { updateMetadata: false },
    );
    assert.equal(
      doc.getTitle(),
      `Certificado de Participação — ${participantName}`,
    );
  }
});

test("a title or organization with nothing printable is refused, pointing the volunteer to the organizer", async () => {
  for (const variant of [
    { eventTitle: "🌱🌱🌱" },
    { organizerName: "김민준", organizerPersonName: "김민준" },
  ]) {
    await assertHttpError(() => renderCertificatePdf(data(variant)), {
      status: 422,
      code: "CERTIFICATE_EVENT_UNPRINTABLE",
    });
  }
});

test("an unprintable responsible-person name hides the line instead of printing 'Responsável:' alone", async () => {
  const doc = await PDFDocument.load(
    await renderCertificatePdf(data({ organizerPersonName: "김민준" })),
  );
  assert.equal(doc.getPageCount(), 1);
});

test("refuses data that would print a broken certificate", async () => {
  const broken: Partial<CertificateDocumentData>[] = [
    { verificationCode: "7KQ2-M9XP-4TDA" },
    { verificationCode: "0KQ2M9XP4TDA" },
    { verificationCode: "7kq2m9xp4tda" },
    { eventStartsAt: new Date("inválida") },
    { issuedAt: new Date(Number.NaN) },
    { workloadHours: Number.POSITIVE_INFINITY },
  ];
  for (const variant of broken) {
    await assertHttpError(() => renderCertificatePdf(data(variant)), {
      status: 500,
      code: "INVALID_CERTIFICATE_DATA",
    });
  }
});
