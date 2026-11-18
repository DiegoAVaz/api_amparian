import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCertificateParagraph,
  formatEventPeriod,
  formatLocation,
  formatLongDate,
  formatVerificationCode,
  formatWorkload,
  type CertificateTextData,
} from "../../src/services/certificates";

// Datas em UTC; Brasília é UTC−3 (sem horário de verão desde 2019).
const brt = (iso: string) => new Date(`${iso}-03:00`);

test("one-day event prints the date and the start-to-end hours", () => {
  assert.equal(
    formatEventPeriod(brt("2026-11-08T08:00:00"), brt("2026-11-08T12:00:00")),
    "em 8 de novembro de 2026, das 8h às 12h",
  );
});

test("minutes appear only when they are not zero", () => {
  assert.equal(
    formatEventPeriod(brt("2026-11-08T08:30:00"), brt("2026-11-08T12:05:00")),
    "em 8 de novembro de 2026, das 8h30 às 12h05",
  );
});

test("event without end time says when it started, without inventing an end", () => {
  assert.equal(
    formatEventPeriod(brt("2026-11-08T08:00:00"), null),
    "em 8 de novembro de 2026, a partir das 8h",
  );
});

test("hours 0 and 1 take the singular article", () => {
  assert.equal(
    formatEventPeriod(brt("2026-11-08T01:00:00"), null),
    "em 8 de novembro de 2026, a partir da 1h",
  );
  assert.equal(
    formatEventPeriod(brt("2026-11-08T00:00:00"), brt("2026-11-08T01:30:00")),
    "em 8 de novembro de 2026, da 0h à 1h30",
  );
});

test("an evening event is one day in Brasília even though it crosses midnight in UTC", () => {
  // 20h–23h em Brasília = 23h–02h em UTC.
  assert.equal(
    formatEventPeriod(brt("2026-11-08T20:00:00"), brt("2026-11-08T23:00:00")),
    "em 8 de novembro de 2026, das 20h às 23h",
  );
});

test("an overnight event is one day: ending at midnight needs no suffix, past it says 'do dia seguinte'", () => {
  assert.equal(
    formatEventPeriod(brt("2026-11-08T20:00:00"), brt("2026-11-09T00:00:00")),
    "em 8 de novembro de 2026, das 20h à 0h",
  );
  assert.equal(
    formatEventPeriod(brt("2026-11-08T22:00:00"), brt("2026-11-09T02:00:00")),
    "em 8 de novembro de 2026, das 22h às 2h do dia seguinte",
  );
  assert.equal(
    formatEventPeriod(brt("2026-11-08T23:00:00"), brt("2026-11-09T01:30:00")),
    "em 8 de novembro de 2026, das 23h à 1h30 do dia seguinte",
  );
});

test("a whole day from midnight to midnight says 'do dia seguinte', never 'da 0h à 0h'", () => {
  assert.equal(
    formatEventPeriod(brt("2026-11-08T00:00:00"), brt("2026-11-09T00:00:00")),
    "em 8 de novembro de 2026, da 0h à 0h do dia seguinte",
  );
});

test("running into the next morning makes it multi-day again", () => {
  assert.equal(
    formatEventPeriod(brt("2026-11-08T20:00:00"), brt("2026-11-09T08:00:00")),
    "de 8 a 9 de novembro de 2026",
  );
});

test("multi-day event prints only the period, repeating month and year only when they change", () => {
  assert.equal(
    formatEventPeriod(brt("2026-11-06T09:00:00"), brt("2026-11-08T18:00:00")),
    "de 6 a 8 de novembro de 2026",
  );
  assert.equal(
    formatEventPeriod(brt("2026-10-30T09:00:00"), brt("2026-11-02T18:00:00")),
    "de 30 de outubro a 2 de novembro de 2026",
  );
  assert.equal(
    formatEventPeriod(brt("2026-12-30T09:00:00"), brt("2027-01-02T18:00:00")),
    "de 30 de dezembro de 2026 a 2 de janeiro de 2027",
  );
});

test("the first day of the month is written 1º", () => {
  assert.equal(
    formatLongDate(brt("2026-11-01T10:00:00")),
    "1º de novembro de 2026",
  );
  assert.equal(
    formatEventPeriod(brt("2026-11-01T09:00:00"), brt("2026-11-03T18:00:00")),
    "de 1º a 3 de novembro de 2026",
  );
});

test("workload is written in hours and minutes, never as a decimal", () => {
  assert.equal(formatWorkload(4), "4 horas");
  assert.equal(formatWorkload(1), "1 hora");
  assert.equal(formatWorkload(2.5), "2 horas e 30 minutos");
  assert.equal(formatWorkload(0.5), "30 minutos");
  assert.equal(formatWorkload(1.33), "1 hora e 20 minutos");
  assert.equal(formatWorkload(1 / 60), "1 minuto");
  assert.equal(formatWorkload(499.99), "499 horas e 59 minutos");
});

test("location uses 'em', which fits any place name, and 'de forma remota' when remote", () => {
  assert.equal(formatLocation("Praça da Sé", false), "em Praça da Sé");
  assert.equal(formatLocation("Parque da Cidade", true), "de forma remota");
  assert.equal(formatLocation(null, true), "de forma remota");
  assert.equal(formatLocation(null, false), null);
  assert.equal(formatLocation("   ", false), null);
});

test("verification code is shown in three blocks of four", () => {
  assert.equal(formatVerificationCode("R4WT8HZN2QKC"), "R4WT-8HZN-2QKC");
});

function paragraph(overrides: Partial<CertificateTextData> = {}): string {
  const data: CertificateTextData = {
    eventTitle: "Mutirão de Plantio",
    organizerName: "Instituto Raízes Verdes",
    eventStartsAt: brt("2026-11-08T08:00:00"),
    eventEndsAt: brt("2026-11-08T12:00:00"),
    eventLocationName: "Parque da Cidade",
    eventIsRemote: false,
    workloadHours: 4,
    ...overrides,
  };
  return buildCertificateParagraph(data)
    .map((run) => (run.strong ? `**${run.text}**` : run.text))
    .join("");
}

test("paragraph with workload ends with the highlighted hours", () => {
  assert.equal(
    paragraph(),
    "participou de forma voluntária da ação **Mutirão de Plantio**, promovida por **Instituto Raízes Verdes**, realizada em 8 de novembro de 2026, das 8h às 12h, em Parque da Cidade, com carga horária de **4 horas**.",
  );
});

test("paragraph without workload ends at the location — never '0 horas' or an empty field", () => {
  assert.equal(
    paragraph({
      eventStartsAt: brt("2026-11-06T09:00:00"),
      eventEndsAt: brt("2026-11-08T18:00:00"),
      workloadHours: null,
    }),
    "participou de forma voluntária da ação **Mutirão de Plantio**, promovida por **Instituto Raízes Verdes**, realizada de 6 a 8 de novembro de 2026, em Parque da Cidade.",
  );
  assert.ok(!paragraph({ workloadHours: 0 }).includes("carga horária"));
  // Menos de 30 segundos arredonda para zero minuto: também some, em vez de "0 minutos".
  assert.ok(!paragraph({ workloadHours: 0.005 }).includes("carga horária"));
});

test("paragraph without location ends at the period", () => {
  assert.equal(
    paragraph({ eventLocationName: null, workloadHours: null }),
    "participou de forma voluntária da ação **Mutirão de Plantio**, promovida por **Instituto Raízes Verdes**, realizada em 8 de novembro de 2026, das 8h às 12h.",
  );
});
