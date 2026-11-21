import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DownloadCertificateUseCase,
  IssueCertificateUseCase,
  ListMyCertificatesUseCase,
  VerifyCertificateUseCase,
} from "../../src/use-cases/certificates/certificate.use-cases";
import { ATTENDANCE_WINDOW_DAYS } from "../../src/utils/event-helpers";
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

  const locks: string[] = [];
  const certificates = {
    transaction: async <T>(fn: (trx: unknown) => Promise<T>) => fn({}),
    lockEventForIssuance: async (eventId: number) => {
      locks.push(`event:${eventId}`);
    },
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
  const registrationRow = () =>
    Object.hasOwn(options, "registrationRow")
      ? options.registrationRow
      : registration();
  const registrations = {
    findEventIdForUser: async () =>
      (registrationRow() as { event_id?: number } | undefined)?.event_id,
    findByIdForUserForUpdate: async () => {
      locks.push("registration");
      return registrationRow();
    },
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
    locks,
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

// ---------------------------------------------------------------------------------------------
// "Meus certificados"
// ---------------------------------------------------------------------------------------------

const DAY = 24 * 3_600_000;

// Um certificado emitido, com o snapshot gravado na emissão.
function issuedRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    registration_id: 50,
    verification_code: "7KQ2M9XP4TDA",
    participant_name: "Maria Eduarda Santos",
    event_title: "Mutirão de Plantio",
    organizer_name: "Instituto Raízes Verdes",
    organizer_person_name: "João Pereira",
    event_starts_at: new Date("2026-10-04T11:00:00.000Z"),
    event_ends_at: new Date("2026-10-04T15:00:00.000Z"),
    event_location_name: "Parque da Cidade",
    event_is_remote: 0,
    event_workload_hours: "4.00",
    blob_key: "certificates/7/a.pdf",
    issued_at: new Date("2026-10-05T12:00:00.000Z"),
    ...overrides,
  };
}

// Uma inscrição candidata: evento de duas horas que terminou há `endedDaysAgo` dias.
function candidate(
  registrationId: number,
  endedDaysAgo: number,
  overrides: Record<string, unknown> = {},
) {
  const ends = new Date(Date.now() - endedDaysAgo * DAY);
  return {
    registration_id: registrationId,
    event_status: "published",
    event_title: `Evento ${registrationId}`,
    starts_at: new Date(ends.getTime() - 2 * 3_600_000),
    ends_at: ends,
    workload_hours: null,
    attendance_status: null,
    ...overrides,
  };
}

function makeList(issued: Row[], candidates: Row[]) {
  const calls: Array<{ op: string; userId: unknown }> = [];
  const certificates = {
    listByUser: async (userId: number) => {
      calls.push({ op: "listByUser", userId });
      return issued;
    },
    listCandidatesByUser: async (userId: number) => {
      calls.push({ op: "listCandidatesByUser", userId });
      return candidates;
    },
  };
  return {
    useCase: new ListMyCertificatesUseCase(certificates as never),
    calls,
  };
}

test("list: an issued certificate shows the snapshot, with the formatted code", async () => {
  const { useCase, calls } = makeList([issuedRecord()], []);

  const result = await useCase.execute(7);

  assert.deepEqual(
    calls.map((call) => call.userId),
    [7, 7],
  );
  assert.deepEqual(result.data, [
    {
      registrationId: 50,
      status: "issued",
      eventTitle: "Mutirão de Plantio",
      eventStartsAt: "2026-10-04T11:00:00.000Z",
      eventEndsAt: "2026-10-04T15:00:00.000Z",
      workloadHours: 4,
      attendanceClosesAt: null,
      certificate: {
        id: 900,
        verificationCode: "7KQ2-M9XP-4TDA",
        issuedAt: "2026-10-05T12:00:00.000Z",
      },
    },
  ]);
  assert.deepEqual(result.summary, { issuedCount: 1, certifiedHours: 4 });
});

test("list: attendance recorded without a certificate is available, with the effective workload", async () => {
  const { useCase } = makeList(
    [],
    [candidate(61, 2, { attendance_status: "present" })],
  );

  const [item] = (await useCase.execute(7)).data;

  assert.equal(item.status, "available");
  // Evento de um dia sem carga informada: vale a duração (RC-03).
  assert.equal(item.workloadHours, 2);
  assert.equal(item.attendanceClosesAt, null);
  assert.equal(item.certificate, null);
});

test("list: no attendance inside the window is awaiting, with the deadline", async () => {
  const row = candidate(62, 2);
  const { useCase } = makeList([], [row]);

  const [item] = (await useCase.execute(7)).data;

  assert.equal(item.status, "awaiting_attendance");
  assert.equal(
    item.attendanceClosesAt,
    new Date(
      row.ends_at.getTime() + ATTENDANCE_WINDOW_DAYS * DAY,
    ).toISOString(),
  );
});

test("list: no attendance after the window closed stays as not recorded", async () => {
  const { useCase } = makeList(
    [],
    [candidate(63, ATTENDANCE_WINDOW_DAYS + 1)],
  );

  const [item] = (await useCase.execute(7)).data;

  assert.equal(item.status, "attendance_not_recorded");
  assert.equal(item.attendanceClosesAt, null);
});

test("list: an event without an end date counts the window from the start", async () => {
  const startedLongAgo = candidate(64, 0, {
    starts_at: new Date(Date.now() - (ATTENDANCE_WINDOW_DAYS + 1) * DAY),
    ends_at: null,
  });
  const startedRecently = candidate(65, 0, {
    starts_at: new Date(Date.now() - DAY),
    ends_at: null,
  });
  const { useCase } = makeList([], [startedLongAgo, startedRecently]);

  const statuses = Object.fromEntries(
    (await useCase.execute(7)).data.map((item) => [
      item.registrationId,
      item.status,
    ]),
  );

  assert.deepEqual(statuses, {
    64: "attendance_not_recorded",
    65: "awaiting_attendance",
  });
});

test("list: an event still going on is left out", async () => {
  const ongoing = candidate(66, 0, {
    starts_at: new Date(Date.now() - 3_600_000),
    ends_at: new Date(Date.now() + 3_600_000),
    attendance_status: "present",
  });
  const { useCase } = makeList([], [ongoing]);

  assert.deepEqual((await useCase.execute(7)).data, []);
});

test("list: newest event first, and certified hours add only what is printed", async () => {
  const { useCase } = makeList(
    [
      issuedRecord({
        id: 901,
        registration_id: 51,
        event_starts_at: new Date("2026-09-01T11:00:00.000Z"),
        event_ends_at: new Date("2026-09-01T13:30:00.000Z"),
        event_workload_hours: "2.50",
      }),
      // Evento de vários dias sem carga: o certificado mostra só o período e soma 0 hora.
      issuedRecord({
        id: 902,
        registration_id: 52,
        event_starts_at: new Date("2026-08-01T11:00:00.000Z"),
        event_ends_at: new Date("2026-08-03T20:00:00.000Z"),
        event_workload_hours: null,
      }),
      issuedRecord({
        id: 903,
        registration_id: 53,
        event_starts_at: new Date("2026-10-10T11:00:00.000Z"),
        event_ends_at: new Date("2026-10-10T12:15:00.000Z"),
        event_workload_hours: "1.25",
      }),
    ],
    // Disponível, mas não emitido: não entra nas horas certificadas.
    [
      candidate(70, 2, {
        attendance_status: "present",
        workload_hours: "8.00",
      }),
    ],
  );

  const result = await useCase.execute(7);

  assert.deepEqual(
    result.data.map((item) => item.registrationId),
    [70, 53, 51, 52],
  );
  assert.deepEqual(result.summary, { issuedCount: 3, certifiedHours: 3.75 });
});

test("list: nothing to show gives an empty list and zero totals", async () => {
  const { useCase } = makeList([], []);

  assert.deepEqual(await useCase.execute(7), {
    data: [],
    summary: { issuedCount: 0, certifiedHours: 0 },
  });
});

test("list: a certificate issued while the list loads shows once, as issued", async () => {
  // A emissão em outra aba gravou entre as duas leituras: a inscrição veio como candidata e como
  // emitida. Vale o emitido.
  const { useCase, calls } = makeList(
    [issuedRecord({ registration_id: 61 })],
    [candidate(61, 2, { attendance_status: "present" })],
  );

  const result = await useCase.execute(7);

  assert.deepEqual(
    calls.map((call) => call.op),
    ["listCandidatesByUser", "listByUser"],
  );
  assert.deepEqual(
    result.data.map((item) => [item.registrationId, item.status]),
    [[61, "issued"]],
  );
});

// ---------------------------------------------------------------------------------------------
// Verificação pública
// ---------------------------------------------------------------------------------------------

function makeVerify(record: Row | undefined) {
  const lookups: string[] = [];
  const certificates = {
    findByVerificationCode: async (code: string) => {
      lookups.push(code);
      return record;
    },
  };
  return {
    useCase: new VerifyCertificateUseCase(certificates as never),
    lookups,
  };
}

test("verify: a known code shows only what is printed, from the snapshot", async () => {
  const { useCase, lookups } = makeVerify(
    issuedRecord({ event_is_remote: 1, event_location_name: null }),
  );

  const result = await useCase.execute("7KQ2M9XP4TDA");

  assert.deepEqual(lookups, ["7KQ2M9XP4TDA"]);
  assert.deepEqual(result, {
    verificationCode: "7KQ2-M9XP-4TDA",
    participantName: "Maria Eduarda Santos",
    eventTitle: "Mutirão de Plantio",
    organizerName: "Instituto Raízes Verdes",
    responsiblePersonName: "João Pereira",
    eventStartsAt: "2026-10-04T11:00:00.000Z",
    eventEndsAt: "2026-10-04T15:00:00.000Z",
    eventLocationName: null,
    eventIsRemote: true,
    workloadHours: 4,
    issuedAt: "2026-10-05T12:00:00.000Z",
  });
  // Nada interno sai na resposta pública (RC-08).
  for (const key of ["id", "registrationId", "blobKey", "blob_key"]) {
    assert.equal(Object.hasOwn(result, key), false, key);
  }
});

test("verify: an unknown code is 404", async () => {
  const { useCase } = makeVerify(undefined);

  await assertHttpError(() => useCase.execute("ZZZZZZZZZZZZ"), {
    status: 404,
    code: "CERTIFICATE_NOT_FOUND",
  });
});

test("verify: the responsible person shows only when the PDF prints that line", async () => {
  // Sem organização pública, "promovida por" já é a própria pessoa: o PDF não repete o nome.
  const samePerson = makeVerify(
    issuedRecord({
      organizer_name: "João Pereira",
      organizer_person_name: "João Pereira",
    }),
  );
  assert.equal(
    (await samePerson.useCase.execute("7KQ2M9XP4TDA")).responsiblePersonName,
    null,
  );

  // Nome que some por inteiro na limpeza do PDF (só emoji): o papel não traz a linha.
  const unprintable = makeVerify(
    issuedRecord({ organizer_person_name: "🌱🌱" }),
  );
  assert.equal(
    (await unprintable.useCase.execute("7KQ2M9XP4TDA")).responsiblePersonName,
    null,
  );
});

// RC-11: a emissão trava o evento antes da inscrição — a mesma ordem da lista de presença e da
// confirmação de inscrição. Em ordem invertida, as duas poderiam esperar uma pela outra para sempre.
test("issuance locks the event row before the registration", async () => {
  const { useCase, locks } = makeIssue({ registrationRow: registration({ event_id: 33 }) });
  await useCase.execute(7, 50);
  assert.deepEqual(locks, ["event:33", "registration"]);
});
