import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CreateEventUseCase,
  DeleteEventUseCase,
  GetOrganizerEventUseCase,
  ListMyEventsUseCase,
  ListOrganizerRegistrationsUseCase,
  PublishEventUseCase,
  UpdateEventUseCase,
  UpdateRegistrationStatusUseCase,
} from "../../src/use-cases/events/organizer-event.use-cases";
import { assertHttpError, futureIso, pastIso, fakePublicUrl } from "../helpers";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizer_id: 7,
    title: "Mutirao",
    summary: "Resumo",
    description: null,
    rules_terms: null,
    starts_at: futureIso(),
    ends_at: null,
    location_name: null,
    is_remote: true,
    capacity: null,
    cover_image_url: null,
    highlight_skill: null,
    status: "draft",
    ...overrides,
  };
}

test("lists organizer events and applies time filter", async () => {
  const future = futureIso(3);
  const past = pastIso(3);
  const events = {
    listByOrganizer: async () => [
      event({ id: 1, title: "Futuro", starts_at: future, status: "published" }),
      event({ id: 2, title: "Passado", starts_at: past, status: "published" }),
    ],
  };

  const result = await new ListMyEventsUseCase(events as never, fakePublicUrl).execute(7, "upcoming");

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].id, "1");
  assert.equal(result.data[0].title, "Futuro");
  assert.equal(result.data[0].filter, "upcoming");
  assert.equal(result.data[0].status, "published");
});

test("gets organizer event detail with types, requirements and computed status", async () => {
  const events = {
    findByOrganizerAndId: async () => event({ id: 1, status: "published", starts_at: futureIso() }),
    findTypesForEvent: async () => [{ code: "education", label: "Educacao" }],
    findRequirementsForEvent: async () => [{ code: "adult", label: "Maior de idade" }],
  };

  const result = await new GetOrganizerEventUseCase(events as never, fakePublicUrl).execute(7, 1);

  assert.equal(result.id, 1);
  assert.equal(result.computedStatus, "active");
  assert.deepEqual(result.types, [{ code: "education", label: "Educacao" }]);
  assert.deepEqual(result.requirements, [{ code: "adult", label: "Maior de idade" }]);
});

test("get organizer event returns 404 when event is not owned", async () => {
  await assertHttpError(
    () =>
      new GetOrganizerEventUseCase({
        findByOrganizerAndId: async () => undefined,
      } as never, fakePublicUrl).execute(7, 999),
    { status: 404, code: "EVENT_NOT_FOUND" },
  );
});

test("creates organizer event and persists lookup relationships", async () => {
  const insertedEvents: unknown[] = [];
  const replacedTypes: unknown[] = [];
  const replacedRequirements: unknown[] = [];
  const events = {
    transaction: async (fn: (trx: unknown) => Promise<unknown>) => fn({}),
    insertEvent: async (_trx: unknown, input: unknown) => {
      insertedEvents.push(input);
      return 15;
    },
    replaceEventTypes: async (_trx: unknown, eventId: number, ids: number[]) => {
      replacedTypes.push({ eventId, ids });
    },
    replaceEventRequirements: async (_trx: unknown, eventId: number, ids: number[]) => {
      replacedRequirements.push({ eventId, ids });
    },
    findByOrganizerAndId: async () => event({ id: 15 }),
    findTypesForEvent: async () => [{ code: "education", label: "Educacao" }],
    findRequirementsForEvent: async () => [{ code: "adult", label: "Maior de idade" }],
  };
  const lookups = {
    findEventTypeIdsByCodes: async () => [{ id: 1, code: "education" }],
    findRequirementIdsByCodes: async () => [{ id: 2, code: "adult" }],
  };

  const result = await new CreateEventUseCase(events as never, lookups as never, fakePublicUrl).execute(7, {
    title: "Evento",
    summary: "Resumo",
    startsAt: futureIso(),
    isRemote: true,
    typeCodes: ["education"],
    requirementCodes: ["adult"],
    publish: false,
  });

  assert.equal(result.id, 15);
  assert.equal((insertedEvents[0] as { organizer_id: number }).organizer_id, 7);
  assert.equal((insertedEvents[0] as { status: string }).status, "draft");
  assert.deepEqual(replacedTypes, [{ eventId: 15, ids: [1] }]);
  assert.deepEqual(replacedRequirements, [{ eventId: 15, ids: [2] }]);
});

test("create organizer event returns 400 for invalid lookup codes", async () => {
  await assertHttpError(
    () =>
      new CreateEventUseCase(
        {} as never,
        {
          findEventTypeIdsByCodes: async () => [],
        } as never,
       fakePublicUrl).execute(7, {
        title: "Evento",
        summary: "Resumo",
        startsAt: futureIso(),
        isRemote: true,
        typeCodes: ["invalid"],
        requirementCodes: [],
        publish: false,
      }),
    { status: 400, code: "INVALID_EVENT_TYPES" },
  );
});

test("updates organizer event fields and lookup relationships", async () => {
  const updatedRows: unknown[] = [];
  const replacedTypes: unknown[] = [];
  const trx = (table: string) => ({
    whereIn: (_column: string, codes: string[]) => ({
      select: async () =>
        table === "event_types"
          ? codes.map((code, index) => ({ id: index + 1, code }))
          : codes.map((code, index) => ({ id: index + 10, code })),
    }),
  });
  const events = {
    findByOrganizerAndId: async () => event({ id: 20 }),
    transaction: async (fn: (trxArg: typeof trx) => Promise<void>) => fn(trx),
    updateEvent: async (_trx: unknown, eventId: number, row: unknown) => {
      updatedRows.push({ eventId, row });
    },
    replaceEventTypes: async (_trx: unknown, eventId: number, ids: number[]) => {
      replacedTypes.push({ eventId, ids });
    },
    replaceEventRequirements: async () => undefined,
    findTypesForEvent: async () => [{ code: "education", label: "Educacao" }],
    findRequirementsForEvent: async () => [],
  };

  const result = await new UpdateEventUseCase(events as never, fakePublicUrl).execute(7, 20, {
    title: "Titulo Novo",
    publish: true,
    typeCodes: ["education"],
  });

  assert.equal(result.id, 20);
  assert.equal((updatedRows[0] as { eventId: number }).eventId, 20);
  assert.equal(((updatedRows[0] as { row: { title: string; status: string } }).row).title, "Titulo Novo");
  assert.equal(((updatedRows[0] as { row: { title: string; status: string } }).row).status, "published");
  assert.deepEqual(replacedTypes, [{ eventId: 20, ids: [1] }]);
});

test("update organizer event returns 404 and invalid lookup errors", async () => {
  await assertHttpError(
    () =>
      new UpdateEventUseCase({
        findByOrganizerAndId: async () => undefined,
      } as never, fakePublicUrl).execute(7, 20, { title: "Novo" }),
    { status: 404, code: "EVENT_NOT_FOUND" },
  );

  const trx = () => ({
    whereIn: () => ({
      select: async () => [],
    }),
  });
  await assertHttpError(
    () =>
      new UpdateEventUseCase({
        findByOrganizerAndId: async () => event({ id: 20 }),
        transaction: async (fn: (trxArg: typeof trx) => Promise<void>) => fn(trx),
        updateEvent: async () => undefined,
      } as never, fakePublicUrl).execute(7, 20, { typeCodes: ["invalid"] }),
    { status: 400, code: "INVALID_EVENT_TYPES" },
  );
});

test("lists organizer registrations with participant contact data", async () => {
  const createdAt = "2026-05-10T10:00:00.000Z";
  const events = {
    findByOrganizerAndId: async () => event({ id: 1 }),
  };
  const registrations = {
    listForOrganizerEvent: async () => [
      {
        id: 11,
        status: "confirmed",
        participant_role: "apoio",
        created_at: createdAt,
        name: "Ana",
        email: "ana@example.com",
        phone: "11999999999",
        city: "Sao Paulo",
        state: "SP",
      },
    ],
  };

  const result = await new ListOrganizerRegistrationsUseCase(
    events as never,
    registrations as never,
  ).execute(7, 1);

  assert.deepEqual(result, {
    data: [
      {
        id: "11",
        name: "Ana",
        role: "apoio",
        email: "ana@example.com",
        phone: "11999999999",
        cityUf: "Sao Paulo / SP",
        registrationDate: new Date(createdAt).toISOString(),
        status: "confirmed",
      },
    ],
  });
});

test("list organizer registrations returns 404 when event is not owned", async () => {
  await assertHttpError(
    () =>
      new ListOrganizerRegistrationsUseCase(
        { findByOrganizerAndId: async () => undefined } as never,
        { listForOrganizerEvent: async () => [] } as never,
      ).execute(7, 1),
    { status: 404, code: "EVENT_NOT_FOUND" },
  );
});

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    event_id: 1,
    user_id: 5,
    status: "pending",
    participant_role: null,
    agreed_responsibility_at: new Date(),
    created_at: new Date(),
    ...overrides,
  };
}

test("publishes a valid draft event", async () => {
  const statusUpdates: Array<{ userId: number; eventId: number; status: string }> = [];
  const events = {
    findByOrganizerAndId: async () => event(),
    findTypesForEvent: async () => [{ code: "education", label: "Educacao" }],
    findRequirementsForEvent: async () => [],
    setStatus: async (userId: number, eventId: number, status: string) => {
      statusUpdates.push({ userId, eventId, status });
      return 1;
    },
  };

  const result = await new PublishEventUseCase(events as never, fakePublicUrl).execute(7, 1);

  assert.equal(Number(result.id), 1);
  assert.deepEqual(statusUpdates, [{ userId: 7, eventId: 1, status: "published" }]);
});

test("publish returns 404 when event is not owned by organizer", async () => {
  const events = {
    findByOrganizerAndId: async () => undefined,
  };

  await assertHttpError(
    () => new PublishEventUseCase(events as never, fakePublicUrl).execute(7, 1),
    { status: 404, code: "EVENT_NOT_FOUND" },
  );
});

test("publish returns 422 for invalid event states", async () => {
  await assertHttpError(
    () =>
      new PublishEventUseCase({
        findByOrganizerAndId: async () => event({ status: "cancelled" }),
      } as never, fakePublicUrl).execute(7, 1),
    { status: 422, code: "EVENT_CANCELLED" },
  );

  await assertHttpError(
    () =>
      new PublishEventUseCase({
        findByOrganizerAndId: async () => event({ status: "published" }),
      } as never, fakePublicUrl).execute(7, 1),
    { status: 422, code: "EVENT_ALREADY_PUBLISHED" },
  );

  await assertHttpError(
    () =>
      new PublishEventUseCase({
        findByOrganizerAndId: async () => event({ starts_at: pastIso(2), ends_at: pastIso(1) }),
      } as never, fakePublicUrl).execute(7, 1),
    { status: 422, code: "EVENT_ENDED" },
  );
});

test("publish requires location for in-person events and at least one type", async () => {
  await assertHttpError(
    () =>
      new PublishEventUseCase({
        findByOrganizerAndId: async () => event({ is_remote: false, location_name: "" }),
      } as never, fakePublicUrl).execute(7, 1),
    { status: 422, code: "EVENT_LOCATION_REQUIRED" },
  );

  await assertHttpError(
    () =>
      new PublishEventUseCase({
        findByOrganizerAndId: async () => event(),
        findTypesForEvent: async () => [],
      } as never, fakePublicUrl).execute(7, 1),
    { status: 422, code: "EVENT_TYPE_REQUIRED" },
  );
});

test("delete removes draft events without registrations", async () => {
  let deleted = false;
  let cancelled = false;
  const events = {
    findByOrganizerAndId: async () => event(),
    deleteByOrganizer: async () => {
      deleted = true;
      return 1;
    },
    setStatus: async () => {
      cancelled = true;
      return 1;
    },
  };
  const registrations = {
    countByEvent: async () => 0,
  };

  await new DeleteEventUseCase(events as never, registrations as never).execute(7, 1);

  assert.equal(deleted, true);
  assert.equal(cancelled, false);
});

test("delete cancels published events instead of deleting", async () => {
  let deleted = false;
  let cancelledStatus: string | null = null;
  const events = {
    findByOrganizerAndId: async () => event({ status: "published" }),
    deleteByOrganizer: async () => {
      deleted = true;
      return 1;
    },
    setStatus: async (_userId: number, _eventId: number, status: string) => {
      cancelledStatus = status;
      return 1;
    },
  };
  const registrations = {
    countByEvent: async () => 0,
  };

  await new DeleteEventUseCase(events as never, registrations as never).execute(7, 1);

  assert.equal(deleted, false);
  assert.equal(cancelledStatus, "cancelled");
});

test("delete returns 422 for ended events", async () => {
  const events = {
    findByOrganizerAndId: async () => event({ starts_at: pastIso(2), ends_at: pastIso(1) }),
  };
  const registrations = {
    countByEvent: async () => 0,
  };

  await assertHttpError(
    () => new DeleteEventUseCase(events as never, registrations as never).execute(7, 1),
    { status: 422, code: "EVENT_ENDED" },
  );
});

function makeUpdateRegistrationUseCase(options: {
  eventRow?: Record<string, unknown> | null;
  registrationRow?: Record<string, unknown>;
  activeRegistrations?: number;
  updateResult?: number;
} = {}) {
  const updates: Array<{ eventId: number; registrationId: number; status: string }> = [];
  const events = {
    transaction: async (fn: (trx: unknown) => Promise<void>) => fn({}),
    findByIdForUpdate: async () =>
      Object.hasOwn(options, "eventRow")
        ? options.eventRow
        : event({ status: "published", capacity: null }),
  };
  const registrations = {
    findByEventAndIdForUpdate: async () => options.registrationRow ?? registration(),
    countActiveByEvent: async () => options.activeRegistrations ?? 0,
    updateStatus: async (eventId: number, registrationId: number, status: string) => {
      updates.push({ eventId, registrationId, status });
      return options.updateResult ?? 1;
    },
  };

  return {
    useCase: new UpdateRegistrationStatusUseCase(events as never, registrations as never),
    updates,
  };
}

test("organizer updates registration status", async () => {
  const { useCase, updates } = makeUpdateRegistrationUseCase();

  const result = await useCase.execute(7, 1, 11, "confirmed");

  assert.deepEqual(result, { id: 11, status: "confirmed" });
  assert.deepEqual(updates, [{ eventId: 1, registrationId: 11, status: "confirmed" }]);
});

test("organizer registration update returns expected 404 and 422 errors", async () => {
  await assertHttpError(
    () =>
      makeUpdateRegistrationUseCase({ eventRow: null }).useCase.execute(
        99,
        1,
        11,
        "confirmed",
      ),
    { status: 404, code: "EVENT_NOT_FOUND" },
  );

  await assertHttpError(
    () =>
      makeUpdateRegistrationUseCase({
        registrationRow: registration({ status: "pending" }),
      }).useCase.execute(7, 1, 11, "pending"),
    { status: 422, code: "REGISTRATION_STATUS_UNCHANGED" },
  );

  await assertHttpError(
    () =>
      makeUpdateRegistrationUseCase({
        registrationRow: registration({ status: "cancelled" }),
      }).useCase.execute(7, 1, 11, "confirmed"),
    { status: 422, code: "REGISTRATION_ALREADY_CANCELLED" },
  );

  await assertHttpError(
    () =>
      makeUpdateRegistrationUseCase({
        eventRow: event({ status: "published", capacity: 1 }),
        activeRegistrations: 2,
      }).useCase.execute(7, 1, 11, "confirmed"),
    { status: 422, code: "CAPACITY_FULL" },
  );
});
