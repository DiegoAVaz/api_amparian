import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATTENDANCE_WINDOW_DAYS,
  RecordAttendanceUseCase,
} from "../../src/use-cases/events/attendance.use-cases";
import { assertHttpError, futureIso, pastIso } from "../helpers";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizer_id: 7,
    title: "Mutirao",
    summary: "Resumo",
    description: null,
    rules_terms: null,
    starts_at: pastIso(2),
    ends_at: pastIso(1),
    location_name: "Parque",
    is_remote: false,
    capacity: null,
    workload_hours: "4.00",
    cover_image_url: null,
    highlight_skill: null,
    status: "published",
    ...overrides,
  };
}

function registration(id: number, status = "confirmed") {
  return { id, event_id: 1, user_id: 100 + id, status, participant_role: null, agreed_responsibility_at: null };
}

type Saved = { registration_id: number; status: string; recorded_by: number; recorded_at: Date };

/**
 * Duplos em memória. O de presença guarda por `registration_id`, como o índice único do banco,
 * para que um segundo salvamento substitua o primeiro em vez de somar.
 */
function makeUseCase(options: {
  eventRow?: Record<string, unknown> | null;
  registrationRows?: Array<Record<string, unknown>>;
  issuedRegistrationIds?: number[];
} = {}) {
  const stored = new Map<number, Saved>();
  const upsertCalls: Saved[][] = [];

  const events = {
    transaction: async <T>(fn: (trx: unknown) => Promise<T>) => fn({}),
    findByIdForUpdate: async () => (Object.hasOwn(options, "eventRow") ? options.eventRow : event()),
  };
  const registrations = {
    findByEventAndIdsForUpdate: async (_eventId: number, ids: number[]) =>
      (options.registrationRows ?? [registration(11), registration(12), registration(13)]).filter((row) =>
        ids.includes(Number(row.id)),
      ),
  };
  const attendances = {
    upsertMany: async (items: Saved[]) => {
      upsertCalls.push(items);
      for (const item of items) stored.set(item.registration_id, item);
    },
    listByEvent: async () =>
      [...stored.values()].map((row) => ({ registration_id: row.registration_id, status: row.status })),
  };

  const certificates = {
    findIssuedRegistrationIds: async (ids: number[]) =>
      (options.issuedRegistrationIds ?? []).filter((id) => ids.includes(id)),
  };

  return {
    useCase: new RecordAttendanceUseCase(
      events as never,
      registrations as never,
      attendances as never,
      certificates as never,
    ),
    upsertCalls,
  };
}

test("records attendance in batch for confirmed registrations and returns the saved list", async () => {
  const { useCase, upsertCalls } = makeUseCase();

  const result = await useCase.execute(7, 1, [
    { registrationId: 11, status: "present" },
    { registrationId: 12, status: "absent" },
  ]);

  assert.deepEqual(result, [
    { registrationId: 11, status: "present" },
    { registrationId: 12, status: "absent" },
  ]);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0][0].recorded_by, 7);
  assert.ok(upsertCalls[0][0].recorded_at instanceof Date);
});

test("saving again replaces the previous status instead of adding a row", async () => {
  const { useCase } = makeUseCase();

  await useCase.execute(7, 1, [{ registrationId: 11, status: "present" }]);
  const result = await useCase.execute(7, 1, [{ registrationId: 11, status: "absent" }]);

  assert.deepEqual(result, [{ registrationId: 11, status: "absent" }]);
});

test("another organizer's event, or a missing one, answers 404 without saving", async () => {
  const other = makeUseCase();
  await assertHttpError(() => other.useCase.execute(99, 1, [{ registrationId: 11, status: "present" }]), {
    status: 404,
    code: "EVENT_NOT_FOUND",
  });
  assert.equal(other.upsertCalls.length, 0);

  const missing = makeUseCase({ eventRow: null });
  await assertHttpError(() => missing.useCase.execute(7, 1, [{ registrationId: 11, status: "present" }]), {
    status: 404,
    code: "EVENT_NOT_FOUND",
  });
});

test("cancelled event refuses attendance", async () => {
  const { useCase, upsertCalls } = makeUseCase({ eventRow: event({ status: "cancelled" }) });

  await assertHttpError(() => useCase.execute(7, 1, [{ registrationId: 11, status: "present" }]), {
    status: 422,
    code: "EVENT_CANCELLED",
  });
  assert.equal(upsertCalls.length, 0);
});

test("attendance opens only when the event starts", async () => {
  const { useCase } = makeUseCase({ eventRow: event({ starts_at: futureIso(1), ends_at: futureIso(2) }) });

  await assertHttpError(() => useCase.execute(7, 1, [{ registrationId: 11, status: "present" }]), {
    status: 422,
    code: "ATTENDANCE_NOT_OPEN",
  });
});

test("an event in progress already accepts attendance", async () => {
  const { useCase } = makeUseCase({ eventRow: event({ starts_at: pastIso(1), ends_at: futureIso(1) }) });

  const result = await useCase.execute(7, 1, [{ registrationId: 11, status: "present" }]);

  assert.deepEqual(result, [{ registrationId: 11, status: "present" }]);
});

test(`window closes ${ATTENDANCE_WINDOW_DAYS} days after the end`, async () => {
  const inside = makeUseCase({
    eventRow: event({ starts_at: pastIso(ATTENDANCE_WINDOW_DAYS), ends_at: pastIso(ATTENDANCE_WINDOW_DAYS - 1) }),
  });
  await inside.useCase.execute(7, 1, [{ registrationId: 11, status: "present" }]);
  assert.equal(inside.upsertCalls.length, 1);

  const outside = makeUseCase({
    eventRow: event({ starts_at: pastIso(ATTENDANCE_WINDOW_DAYS + 2), ends_at: pastIso(ATTENDANCE_WINDOW_DAYS + 1) }),
  });
  await assertHttpError(() => outside.useCase.execute(7, 1, [{ registrationId: 11, status: "present" }]), {
    status: 422,
    code: "ATTENDANCE_WINDOW_CLOSED",
  });
  assert.equal(outside.upsertCalls.length, 0);
});

test("without an end date the window counts from the start, and the message says so", async () => {
  const { useCase } = makeUseCase({
    eventRow: event({ starts_at: pastIso(ATTENDANCE_WINDOW_DAYS + 1), ends_at: null }),
  });

  const error = await assertHttpError(() => useCase.execute(7, 1, [{ registrationId: 11, status: "present" }]), {
    status: 422,
    code: "ATTENDANCE_WINDOW_CLOSED",
  });
  assert.match(error.message, /após o início do evento/);
});

test("an empty batch saves nothing and returns the current list", async () => {
  const { useCase, upsertCalls } = makeUseCase();
  await useCase.execute(7, 1, [{ registrationId: 11, status: "present" }]);

  const result = await useCase.execute(7, 1, []);

  assert.deepEqual(result, [{ registrationId: 11, status: "present" }]);
  assert.equal(upsertCalls.length, 2);
  assert.deepEqual(upsertCalls[1], []);
});

test("a registration from another event answers 404 and nothing is saved", async () => {
  const { useCase, upsertCalls } = makeUseCase();

  await assertHttpError(
    () =>
      useCase.execute(7, 1, [
        { registrationId: 11, status: "present" },
        { registrationId: 999, status: "present" },
      ]),
    { status: 404, code: "REGISTRATION_NOT_FOUND" },
  );
  assert.equal(upsertCalls.length, 0);
});

test("pending or cancelled registrations cannot receive attendance", async () => {
  for (const status of ["pending", "cancelled"]) {
    const { useCase, upsertCalls } = makeUseCase({
      registrationRows: [registration(11), registration(12, status)],
    });

    await assertHttpError(
      () =>
        useCase.execute(7, 1, [
          { registrationId: 11, status: "present" },
          { registrationId: 12, status: "present" },
        ]),
      { status: 422, code: "REGISTRATION_NOT_CONFIRMED" },
    );
    assert.equal(upsertCalls.length, 0, `nada deveria ser gravado com inscrição ${status}`);
  }
});

test("the same registration twice in one batch is refused", async () => {
  const { useCase, upsertCalls } = makeUseCase();

  await assertHttpError(
    () =>
      useCase.execute(7, 1, [
        { registrationId: 11, status: "present" },
        { registrationId: 11, status: "absent" },
      ]),
    { status: 422, code: "ATTENDANCE_DUPLICATED_REGISTRATION" },
  );
  assert.equal(upsertCalls.length, 0);
});

// RC-04: depois da emissão do certificado, a presença daquela inscrição não muda mais.
test("refuses to change the attendance of someone who already issued the certificate", async () => {
  const { useCase, upsertCalls } = makeUseCase({ issuedRegistrationIds: [11] });

  const error = await assertHttpError(
    () =>
      useCase.execute(7, 1, [
        { registrationId: 11, status: "absent" },
        { registrationId: 12, status: "present" },
      ]),
    { status: 422, code: "ATTENDANCE_LOCKED" },
  );
  // A tela recebe quais linhas estão travadas.
  assert.deepEqual(error.details, { context: { registrationIds: [11] } });
  // A recusa vale para o envio inteiro: nem a outra inscrição é gravada.
  assert.equal(upsertCalls.length, 0);
});

test("re-sending 'present' for a locked registration is accepted and left untouched", async () => {
  const { useCase, upsertCalls } = makeUseCase({ issuedRegistrationIds: [11] });

  await useCase.execute(7, 1, [
    { registrationId: 11, status: "present" },
    { registrationId: 12, status: "absent" },
  ]);

  // A linha travada não é regravada (nem `recorded_by`/`recorded_at`), mas o envio não falha.
  assert.deepEqual(
    upsertCalls[0].map((item) => item.registration_id),
    [12],
  );
});
