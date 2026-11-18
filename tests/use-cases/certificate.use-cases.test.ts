import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DownloadCertificateUseCase,
  IssueCertificateUseCase,
} from "../../src/use-cases/certificates/certificate.use-cases";
import { assertHttpError, futureIso, pastIso } from "../helpers";

const CONFIG = { appWebUrl: "https://amparian-front.vercel.app" };

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    event_id: 1,
    user_id: 7,
    status: "confirmed",
    participant_role: null,
    agreed_responsibility_at: null,
    ...overrides,
  };
}

// Um evento de um dia já encerrado (8h às 12h de ontem, em UTC), com presença registrada.
function context(overrides: Record<string, unknown> = {}) {
  const starts = new Date(Date.now() - 2 * 24 * 3_600_000);
  starts.setUTCHours(11, 0, 0, 0);
  const ends = new Date(starts.getTime() + 4 * 3_600_000);
  return {
    registration_id: 50,
    participant_name: "Maria Eduarda Santos",
    event_status: "published",
    event_title: "Mutirão de Plantio",
    starts_at: starts,
    ends_at: ends,
    location_name: "Parque da Cidade",
    is_remote: 0,
    workload_hours: null,
    organizer_name: "João Pereira",
    organizer_public_name: "Instituto Raízes Verdes",
    attendance_status: "present",
    ...overrides,
  };
}

type Row = Record<string, unknown>;

/**
 * Duplos em memória. O repositório guarda os certificados numa lista e simula as duas regras de
 * unicidade (inscrição e código). O "PDF" falso carrega o código, para o teste ver que cada sorteio
 * gerou o documento de novo.
 */
function makeIssue(
  options: {
    registrationRow?: Row | null;
    contextRow?: Row | null;
    existing?: Row | null;
    codes?: string[];
    putFails?: boolean;
    setBlobKeyResult?: number;
    takenCodes?: string[];
    renderError?: Error;
    // Simula outra transação gravando o certificado da mesma inscrição entre a conferência e o
    // INSERT; `racedRow` é o que a releitura encontra (ou `null`, se não enxerga).
    registrationConflict?: boolean;
    racedRow?: Row | null;
  } = {},
) {
  let reads = 0;
  const inserted: Row[] = [];
  const rendered: Row[] = [];
  const storageCalls: Array<{ op: string; key: string }> = [];
  const blobKeys: Array<{ id: number; key: string; expected: string | null }> =
    [];
  const codes = [...(options.codes ?? ["7KQ2M9XP4TDA"])];
  const taken = new Set(options.takenCodes ?? []);

  const certificates = {
    transaction: async <T>(fn: (trx: unknown) => Promise<T>) => fn({}),
    findByRegistrationId: async () => {
      reads += 1;
      if (reads > 1 && options.registrationConflict) {
        return options.racedRow ?? undefined;
      }
      return options.existing ?? undefined;
    },
    findIssuanceContext: async () =>
      Object.hasOwn(options, "contextRow") ? options.contextRow : context(),
    insert: async (row: Row) => {
      if (options.registrationConflict) {
        return { ok: false, conflict: "registration" };
      }
      if (taken.has(String(row.verification_code))) {
        return { ok: false, conflict: "code" };
      }
      inserted.push(row);
      return { ok: true, id: 900 };
    },
    setBlobKey: async (id: number, key: string, expected: string | null) => {
      blobKeys.push({ id, key, expected });
      return options.setBlobKeyResult ?? 1;
    },
  };
  const registrations = {
    findByIdForUserForUpdate: async () =>
      Object.hasOwn(options, "registrationRow")
        ? options.registrationRow
        : registration(),
  };
  const storage = {
    put: async (key: string) => {
      storageCalls.push({ op: "put", key });
      if (options.putFails) throw new Error("Azure fora do ar");
      return { key, contentType: "application/pdf", size: 1 };
    },
    delete: async (key: string) => {
      storageCalls.push({ op: "delete", key });
    },
    get: async () => null,
  };
  const tools = {
    render: async (data: Row) => {
      rendered.push(data);
      if (options.renderError) throw options.renderError;
      return Buffer.from(`%PDF-${String(data.verificationCode)}`);
    },
    generateCode: () => codes.shift() ?? "ZZZZZZZZZZZZ",
  };

  return {
    useCase: new IssueCertificateUseCase(
      certificates as never,
      registrations as never,
      storage as never,
      CONFIG,
      tools as never,
    ),
    inserted,
    rendered,
    storageCalls,
    blobKeys,
  };
}

test("issues the certificate with a snapshot of what is printed, then stores the PDF", async () => {
  const { useCase, inserted, rendered, storageCalls, blobKeys } = makeIssue();

  const { certificate, created } = await useCase.execute(7, 50);

  assert.equal(created, true);
  assert.equal(certificate.id, 900);
  assert.equal(certificate.verificationCode, "7KQ2-M9XP-4TDA");
  assert.equal(certificate.workloadHours, 4);

  const row = inserted[0];
  assert.equal(row.participant_name, "Maria Eduarda Santos");
  // "Promovida por" é a organização pública; o responsável é a pessoa (RC-06).
  assert.equal(row.organizer_name, "Instituto Raízes Verdes");
  assert.equal(row.organizer_person_name, "João Pereira");
  // Carga efetiva já resolvida: sem carga informada, a duração do evento de um dia (RC-03).
  assert.equal(row.event_workload_hours, "4.00");
  assert.equal(row.event_is_remote, false);
  assert.equal(row.verification_code, "7KQ2M9XP4TDA");
  assert.equal((row.issued_at as Date).getMilliseconds(), 0);

  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].appWebUrl, CONFIG.appWebUrl);

  assert.equal(storageCalls[0].op, "put");
  assert.match(storageCalls[0].key, /^certificates\/7\/[0-9a-f-]{36}\.pdf$/);
  assert.deepEqual(blobKeys, [
    { id: 900, key: storageCalls[0].key, expected: null },
  ]);
});

test("without a public organization, the organizer's own name is who promotes the action", async () => {
  const { useCase, inserted } = makeIssue({
    contextRow: context({ organizer_public_name: "  " }),
  });
  await useCase.execute(7, 50);
  assert.equal(inserted[0].organizer_name, "João Pereira");
});

test("a multi-day event without informed workload is certified with the period only", async () => {
  const { useCase, inserted } = makeIssue({
    contextRow: context({ starts_at: pastIso(5), ends_at: pastIso(2) }),
  });
  const { certificate } = await useCase.execute(7, 50);
  assert.equal(inserted[0].event_workload_hours, null);
  assert.equal(certificate.workloadHours, null);
});

test("asking again returns the same certificate without rendering or storing anything", async () => {
  const existing = {
    id: 900,
    registration_id: 50,
    verification_code: "7KQ2M9XP4TDA",
    participant_name: "Maria Eduarda Santos",
    event_title: "Mutirão de Plantio",
    organizer_name: "Instituto Raízes Verdes",
    organizer_person_name: "João Pereira",
    event_starts_at: new Date("2026-11-08T11:00:00Z"),
    event_ends_at: new Date("2026-11-08T15:00:00Z"),
    event_location_name: "Parque da Cidade",
    event_is_remote: 0,
    event_workload_hours: "4.00",
    blob_key: "certificates/7/a.pdf",
    issued_at: new Date("2026-11-10T15:00:00Z"),
  };
  const { useCase, inserted, rendered, storageCalls } = makeIssue({
    existing,
  });

  const { certificate, created } = await useCase.execute(7, 50);

  assert.equal(created, false);
  assert.equal(certificate.id, 900);
  assert.equal(certificate.issuedAt, "2026-11-10T15:00:00.000Z");
  assert.equal(inserted.length + rendered.length + storageCalls.length, 0);
});

test("someone else's registration answers as if it did not exist", async () => {
  const { useCase } = makeIssue({ registrationRow: null });
  await assertHttpError(() => useCase.execute(7, 50), {
    status: 404,
    code: "REGISTRATION_NOT_FOUND",
  });
});

test("each missing eligibility condition is refused with its own code (RC-01)", async () => {
  const cases: Array<[Parameters<typeof makeIssue>[0], string]> = [
    [
      { registrationRow: registration({ status: "pending" }) },
      "REGISTRATION_NOT_CONFIRMED",
    ],
    [
      { registrationRow: registration({ status: "cancelled" }) },
      "REGISTRATION_NOT_CONFIRMED",
    ],
    [{ contextRow: context({ event_status: "cancelled" }) }, "EVENT_CANCELLED"],
    [
      { contextRow: context({ starts_at: pastIso(1), ends_at: futureIso(1) }) },
      "EVENT_NOT_ENDED",
    ],
    [
      { contextRow: context({ attendance_status: null }) },
      "ATTENDANCE_NOT_RECORDED",
    ],
    [
      { contextRow: context({ attendance_status: "absent" }) },
      "ATTENDANCE_ABSENT",
    ],
  ];
  for (const [options, code] of cases) {
    const { useCase, inserted } = makeIssue(options);
    await assertHttpError(() => useCase.execute(7, 50), { status: 422, code });
    assert.equal(inserted.length, 0, code);
  }
});

test("a name the certificate cannot print is refused before anything is written", async () => {
  const { useCase, inserted, rendered } = makeIssue({
    contextRow: context({ participant_name: "Kim 김민준" }),
  });
  await assertHttpError(() => useCase.execute(7, 50), {
    status: 422,
    code: "CERTIFICATE_NAME_UNPRINTABLE",
  });
  assert.equal(inserted.length + rendered.length, 0);
});

// Exigência do cert-3: o PDF é gerado ANTES do INSERT. Se o gerador recusa (título que não se
// imprime, texto que não cabe), nenhuma linha fica para trás sem PDF.
test("a renderer refusal writes nothing and nothing is uploaded", async () => {
  const refusal = Object.assign(new Error("título impossível"), {
    status: 422,
    code: "CERTIFICATE_EVENT_UNPRINTABLE",
  });
  const { useCase, inserted, storageCalls } = makeIssue({
    renderError: refusal,
  });

  await assertHttpError(() => useCase.execute(7, 50), {
    status: 422,
    code: "CERTIFICATE_EVENT_UNPRINTABLE",
  });
  assert.equal(inserted.length, 0);
  assert.equal(storageCalls.length, 0);
});

test("if another issuance wins the race, its certificate is returned instead of a new one", async () => {
  const raced = {
    id: 901,
    registration_id: 50,
    verification_code: "R4WT8HZN2QKC",
    participant_name: "Maria Eduarda Santos",
    event_title: "Mutirão de Plantio",
    organizer_name: "Instituto Raízes Verdes",
    organizer_person_name: "João Pereira",
    event_starts_at: new Date("2026-11-08T11:00:00Z"),
    event_ends_at: new Date("2026-11-08T15:00:00Z"),
    event_location_name: "Parque da Cidade",
    event_is_remote: 0,
    event_workload_hours: "4.00",
    blob_key: null,
    issued_at: new Date("2026-11-10T15:00:00Z"),
  };
  const { useCase, storageCalls } = makeIssue({
    registrationConflict: true,
    racedRow: raced,
  });

  const { certificate, created } = await useCase.execute(7, 50);

  assert.equal(created, false);
  assert.equal(certificate.id, 901);
  assert.equal(storageCalls.length, 0);
});

test("a race this transaction cannot see is a 409 of its own, not 'no free code'", async () => {
  const { useCase } = makeIssue({ registrationConflict: true, racedRow: null });
  await assertHttpError(() => useCase.execute(7, 50), {
    status: 409,
    code: "CERTIFICATE_ISSUE_CONFLICT",
  });
});

test("a code collision draws a new code and renders the PDF again with it (RC-07)", async () => {
  const { useCase, inserted, rendered } = makeIssue({
    codes: ["AAAAAAAAAAAA", "BBBBBBBBBBBB"],
    takenCodes: ["AAAAAAAAAAAA"],
  });

  const { certificate } = await useCase.execute(7, 50);

  assert.equal(certificate.verificationCode, "BBBB-BBBB-BBBB");
  assert.deepEqual(
    rendered.map((data) => data.verificationCode),
    ["AAAAAAAAAAAA", "BBBBBBBBBBBB"],
  );
  assert.equal(inserted.length, 1);
});

test("gives up after five collisions in a row instead of looping", async () => {
  const { useCase } = makeIssue({
    codes: [
      "AAAAAAAAAAAA",
      "AAAAAAAAAAAA",
      "AAAAAAAAAAAA",
      "AAAAAAAAAAAA",
      "AAAAAAAAAAAA",
    ],
    takenCodes: ["AAAAAAAAAAAA"],
  });
  await assertHttpError(() => useCase.execute(7, 50), {
    status: 500,
    code: "CERTIFICATE_CODE_UNAVAILABLE",
  });
});

test("a failed upload still issues the certificate; the PDF is generated again on download", async () => {
  const { useCase, blobKeys } = makeIssue({ putFails: true });

  const { certificate, created } = await useCase.execute(7, 50);

  assert.equal(created, true);
  assert.equal(certificate.id, 900);
  assert.equal(blobKeys.length, 0);
});

test("if the key is not saved after the upload, the orphan blob is deleted", async () => {
  const { useCase, storageCalls } = makeIssue({ setBlobKeyResult: 0 });

  await useCase.execute(7, 50);

  assert.deepEqual(
    storageCalls.map((call) => call.op),
    ["put", "delete"],
  );
  assert.equal(storageCalls[0].key, storageCalls[1].key);
});

// ---------------------------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------------------------

function storedCertificate(overrides: Row = {}) {
  return {
    id: 900,
    registration_id: 50,
    verification_code: "7KQ2M9XP4TDA",
    participant_name: "Maria Eduarda Santos",
    event_title: "Mutirão de Plantio",
    organizer_name: "Instituto Raízes Verdes",
    organizer_person_name: "João Pereira",
    event_starts_at: new Date("2026-11-08T11:00:00Z"),
    event_ends_at: new Date("2026-11-08T15:00:00Z"),
    event_location_name: "Parque da Cidade",
    event_is_remote: 0,
    event_workload_hours: "4.00",
    blob_key: "certificates/7/original.pdf",
    issued_at: new Date("2026-11-10T15:00:00Z"),
    ...overrides,
  };
}

function makeDownload(
  options: {
    record?: Row | null;
    stored?: Buffer | null;
    getFails?: boolean;
    setBlobKeyResult?: number;
  } = {},
) {
  const rendered: Row[] = [];
  const storageCalls: Array<{ op: string; key: string }> = [];
  const blobKeys: Array<{ key: string; expected: string | null }> = [];

  const certificates = {
    findByIdForUser: async () =>
      Object.hasOwn(options, "record") ? options.record : storedCertificate(),
    setBlobKey: async (_id: number, key: string, expected: string | null) => {
      blobKeys.push({ key, expected });
      return options.setBlobKeyResult ?? 1;
    },
  };
  const storage = {
    get: async (key: string) => {
      storageCalls.push({ op: "get", key });
      if (options.getFails) throw new Error("Azure fora do ar");
      return Object.hasOwn(options, "stored")
        ? options.stored
        : Buffer.from("%PDF-armazenado");
    },
    put: async (key: string) => {
      storageCalls.push({ op: "put", key });
      return { key, contentType: "application/pdf", size: 1 };
    },
    delete: async (key: string) => {
      storageCalls.push({ op: "delete", key });
    },
  };
  const tools = {
    render: async (data: Row) => {
      rendered.push(data);
      return Buffer.from("%PDF-regenerado");
    },
  };

  return {
    useCase: new DownloadCertificateUseCase(
      certificates as never,
      storage as never,
      CONFIG,
      tools as never,
    ),
    rendered,
    storageCalls,
    blobKeys,
  };
}

test("download returns the stored PDF with a file name carrying the code", async () => {
  const { useCase, rendered } = makeDownload();

  const { pdf, fileName } = await useCase.execute(7, 900);

  assert.equal(pdf.toString(), "%PDF-armazenado");
  assert.equal(fileName, "certificado-amparian-7KQ2-M9XP-4TDA.pdf");
  assert.equal(rendered.length, 0);
});

test("someone else's certificate answers as if it did not exist", async () => {
  const { useCase } = makeDownload({ record: null });
  await assertHttpError(() => useCase.execute(7, 900), {
    status: 404,
    code: "CERTIFICATE_NOT_FOUND",
  });
});

test("a lost PDF is generated again from the snapshot and stored under a new key", async () => {
  const { useCase, rendered, storageCalls, blobKeys } = makeDownload({
    stored: null,
  });

  const { pdf } = await useCase.execute(7, 900);

  assert.equal(pdf.toString(), "%PDF-regenerado");
  // O PDF regenerado sai dos dados gravados, não do evento como está hoje (RC-06).
  assert.equal(rendered[0].participantName, "Maria Eduarda Santos");
  assert.equal(rendered[0].workloadHours, 4);
  assert.equal(rendered[0].eventIsRemote, false);
  assert.equal(
    (rendered[0].issuedAt as Date).toISOString(),
    "2026-11-10T15:00:00.000Z",
  );
  const put = storageCalls.find((call) => call.op === "put");
  assert.ok(put);
  // Troca a chave só se ninguém trocou antes (a esperada é a antiga).
  assert.deepEqual(blobKeys, [
    { key: put.key, expected: "certificates/7/original.pdf" },
  ]);
});

test("a certificate whose upload failed at issuance is generated on its first download", async () => {
  const { useCase, storageCalls, blobKeys } = makeDownload({
    record: storedCertificate({ blob_key: null }),
  });

  await useCase.execute(7, 900);

  assert.ok(!storageCalls.some((call) => call.op === "get"));
  assert.equal(blobKeys[0].expected, null);
});

test("with the container down, the volunteer still gets the PDF, and nothing is uploaded", async () => {
  const { useCase, storageCalls } = makeDownload({ getFails: true });

  const { pdf } = await useCase.execute(7, 900);

  assert.equal(pdf.toString(), "%PDF-regenerado");
  assert.deepEqual(
    storageCalls.map((call) => call.op),
    ["get"],
  );
});

test("two downloads regenerating at once: the loser deletes the blob it just uploaded", async () => {
  const { useCase, storageCalls } = makeDownload({
    stored: null,
    setBlobKeyResult: 0,
  });

  await useCase.execute(7, 900);

  assert.deepEqual(
    storageCalls.map((call) => call.op),
    ["get", "put", "delete"],
  );
});
