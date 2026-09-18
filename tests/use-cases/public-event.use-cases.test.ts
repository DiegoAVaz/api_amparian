import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GetPublicEventUseCase,
  ListPublicEventsUseCase,
  RegisterForEventUseCase,
} from "../../src/use-cases/events/public-event.use-cases";
import { assertHttpError, futureIso, pastIso, fakePublicUrl } from "../helpers";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizer_id: 2,
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
    status: "published",
    ...overrides,
  };
}

test("lists public published events with pagination metadata", async () => {
  const startsAt = futureIso();
  const events = {
    findPublishedListRow: async (params: { q?: string; page: number; limit: number }) => ({
      rows: [
        {
          id: 1,
          title: "Mutirao",
          summary: "Resumo",
          starts_at: startsAt,
          location_name: null,
          is_remote: 1,
          capacity: 30,
          cover_image_url: "https://example.com/cover.png",
          public_organization_name: "ONG Teste",
          organizer_name: "Organizador",
        },
      ],
      total: params.q === "educacao" ? 1 : 0,
    }),
  };

  const result = await new ListPublicEventsUseCase(events as never, fakePublicUrl).execute({
    q: "educacao",
    page: 2,
    limit: 10,
  });

  assert.deepEqual(result, {
    data: [
      {
        id: 1,
        title: "Mutirao",
        summary: "Resumo",
        org: "ONG Teste",
        startsAt: new Date(startsAt).toISOString(),
        locationName: null,
        isRemote: true,
        capacity: 30,
        coverImageUrl: "https://example.com/cover.png",
        imageKey: null,
      },
    ],
    meta: { page: 2, limit: 10, total: 1 },
  });
});

test("gets public event detail with lookups and organizer display name", async () => {
  const startsAt = futureIso();
  const endsAt = futureIso(2);
  const events = {
    findPublishedByIdWithOrganizer: async () =>
      event({
        organizer_id: 12,
        starts_at: startsAt,
        ends_at: endsAt,
        description: "Descricao",
        rules_terms: "Termos",
        location_name: "Centro",
        is_remote: 0,
        capacity: 20,
        highlight_skill: "Logistica",
        cover_image_url: "https://example.com/cover.png",
        public_organization_name: null,
        organizer_name: "Maria",
      }),
    findTypesForEvent: async () => [{ code: "education", label: "Educacao" }],
    findRequirementsForEvent: async () => [{ code: "adult", label: "Maior de idade" }],
  };

  const result = await new GetPublicEventUseCase(events as never, fakePublicUrl).execute(1);

  assert.equal(result.id, 1);
  assert.equal(result.org, "Maria");
  assert.equal(result.organizerId, 12);
  assert.equal(result.startsAt, new Date(startsAt).toISOString());
  assert.equal(result.endsAt, new Date(endsAt).toISOString());
  assert.equal(result.isRemote, false);
  assert.deepEqual(result.types, [{ code: "education", label: "Educacao" }]);
  assert.deepEqual(result.requirements, [{ code: "adult", label: "Maior de idade" }]);
});

test("get public event returns 404 when published event is not found", async () => {
  const events = {
    findPublishedByIdWithOrganizer: async () => undefined,
  };

  await assertHttpError(
    () => new GetPublicEventUseCase(events as never, fakePublicUrl).execute(999),
    { status: 404, code: "EVENT_NOT_FOUND" },
  );
});

function makeUseCase(options: {
  eventRow?: Record<string, unknown>;
  existingRegistration?: unknown;
  activeRegistrations?: number;
  insertId?: number;
} = {}) {
  const inserted: unknown[] = [];
  const events = {
    transaction: async (fn: (trx: unknown) => Promise<unknown>) => fn({}),
    findByIdForUpdate: async () => options.eventRow ?? event(),
  };
  const registrations = {
    findByEventAndUser: async () => options.existingRegistration,
    countActiveByEvent: async () => options.activeRegistrations ?? 0,
    insert: async (input: unknown) => {
      inserted.push(input);
      return options.insertId ?? 10;
    },
  };

  return {
    useCase: new RegisterForEventUseCase(events as never, registrations as never),
    inserted,
  };
}

test("registers user for a published event", async () => {
  const { useCase, inserted } = makeUseCase();

  const result = await useCase.execute(1, 9, {
    participantRole: "apoio",
    agreedResponsibility: true,
  });

  assert.equal(result.id, 10);
  assert.equal(result.eventId, 1);
  assert.equal(result.status, "pending");
  assert.equal(result.participantRole, "apoio");
  assert.equal(inserted.length, 1);
  assert.deepEqual(inserted[0], {
    event_id: 1,
    user_id: 9,
    status: "pending",
    participant_role: "apoio",
    agreed_responsibility_at: (inserted[0] as { agreed_responsibility_at: Date }).agreed_responsibility_at,
  });
  assert.ok((inserted[0] as { agreed_responsibility_at: Date }).agreed_responsibility_at instanceof Date);
});

test("returns 404 when public event is not published or does not exist", async () => {
  const { useCase } = makeUseCase({ eventRow: event({ status: "draft" }) });

  await assertHttpError(
    () => useCase.execute(1, 9, { agreedResponsibility: true }),
    { status: 404, code: "EVENT_NOT_FOUND" },
  );
});

test("returns 422 when event is ended", async () => {
  const { useCase } = makeUseCase({
    eventRow: event({ starts_at: pastIso(2), ends_at: pastIso(1) }),
  });

  await assertHttpError(
    () => useCase.execute(1, 9, { agreedResponsibility: true }),
    { status: 422, code: "EVENT_ENDED" },
  );
});

test("returns 409 when user is already registered", async () => {
  const { useCase } = makeUseCase({ existingRegistration: { id: 1 } });

  await assertHttpError(
    () => useCase.execute(1, 9, { agreedResponsibility: true }),
    { status: 409, code: "ALREADY_REGISTERED" },
  );
});

test("returns 422 when capacity is full", async () => {
  const { useCase } = makeUseCase({
    eventRow: event({ capacity: 2 }),
    activeRegistrations: 2,
  });

  await assertHttpError(
    () => useCase.execute(1, 9, { agreedResponsibility: true }),
    { status: 422, code: "CAPACITY_FULL" },
  );
});

test("returns 400 when responsibility terms are not accepted", async () => {
  const { useCase } = makeUseCase();

  await assertHttpError(
    () => useCase.execute(1, 9, { agreedResponsibility: false }),
    { status: 400, code: "TERMS_REQUIRED" },
  );
});

// A coluna reaproveitada guarda dois tipos de valor. O caso da URL legada já é
// coberto acima; este cobre o que a feature de upload realmente grava — sem
// ele, apagar a chamada ao resolvedor deixaria a suíte inteira verde.
test("uma chave de blob vira URL pública, e imageKey devolve a chave", async () => {
  const startsAt = futureIso(3);
  const events = {
    findPublishedListRow: async () => ({
      rows: [
        {
          id: 7,
          title: "Com capa enviada",
          summary: "Resumo",
          starts_at: startsAt,
          location_name: null,
          is_remote: 0,
          capacity: null,
          cover_image_url: "events/7/cover-abc.png",
          public_organization_name: null,
          organizer_name: "Organizador",
        },
      ],
      total: 1,
    }),
  };

  const { data } = await new ListPublicEventsUseCase(
    events as never,
    fakePublicUrl,
  ).execute({ page: 1, limit: 10 });

  assert.equal(data[0].coverImageUrl, "https://cdn.teste/events/7/cover-abc.png");
  assert.equal(data[0].imageKey, "events/7/cover-abc.png");
});
