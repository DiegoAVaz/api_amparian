import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CancelRegistrationUseCase,
  GetMyAgendaUseCase,
  ListMyRegistrationsUseCase,
} from "../../src/use-cases/events/participant-event.use-cases";
import { assertHttpError, futureIso, pastIso } from "../helpers";

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "pending",
    event_id: 2,
    event_status: "published",
    starts_at: futureIso(),
    ends_at: null,
    ...overrides,
  };
}

test("lists current user registrations with pagination", async () => {
  const startsAt = futureIso();
  const registrations = {
    listForUserPaginated: async (userId: number, page: number, limit: number) => ({
      rows: [
        {
          id: 3,
          status: "confirmed",
          event_id: 10,
          title: "Mutirao",
          starts_at: startsAt,
          public_organization_name: "ONG Teste",
          organizer_name: "Organizador",
        },
      ],
      total: userId === 5 ? 1 : 0,
      page,
      limit,
    }),
  };

  const result = await new ListMyRegistrationsUseCase(registrations as never).execute(5, 2, 20);

  assert.deepEqual(result, {
    data: [
      {
        id: 3,
        status: "confirmed",
        event: {
          id: 10,
          title: "Mutirao",
          org: "ONG Teste",
          startsAt: new Date(startsAt).toISOString(),
        },
      },
    ],
    meta: { page: 2, limit: 20, total: 1 },
  });
});

test("gets monthly agenda for current user", async () => {
  const startsAt = "2026-05-10T12:00:00.000Z";
  const calls: Array<{ userId: number; start: Date; end: Date }> = [];
  const registrations = {
    agendaForUserMonth: async (userId: number, start: Date, end: Date) => {
      calls.push({ userId, start, end });
      return [
        {
          id: 10,
          title: "Mutirao",
          starts_at: startsAt,
          public_organization_name: null,
          organizer_name: "Maria",
        },
      ];
    },
  };

  const result = await new GetMyAgendaUseCase(registrations as never).execute(5, 2026, 5);

  assert.equal(calls[0].userId, 5);
  assert.equal(calls[0].start.toISOString(), "2026-05-01T00:00:00.000Z");
  assert.equal(calls[0].end.toISOString(), "2026-05-31T23:59:59.999Z");
  assert.equal(result.data[0].eventId, 10);
  assert.equal(result.data[0].title, "Mutirao");
  assert.equal(result.data[0].org, "Maria");
  assert.equal(result.data[0].startsAt, startsAt);
});

function makeUseCase(options: {
  registrationRow?: Record<string, unknown>;
  cancelResult?: number;
} = {}) {
  let cancelledWith: { userId: number; registrationId: number } | null = null;
  const registrations = {
    findForUserWithEvent: async () => options.registrationRow,
    cancelForUser: async (userId: number, registrationId: number) => {
      cancelledWith = { userId, registrationId };
      return options.cancelResult ?? 1;
    },
  };

  return {
    useCase: new CancelRegistrationUseCase(registrations as never),
    getCancelledWith: () => cancelledWith,
  };
}

test("cancels an active user registration", async () => {
  const { useCase, getCancelledWith } = makeUseCase({
    registrationRow: registration(),
  });

  await useCase.execute(5, 10);

  assert.deepEqual(getCancelledWith(), { userId: 5, registrationId: 10 });
});

test("returns 404 when user registration is not found", async () => {
  const { useCase } = makeUseCase();

  await assertHttpError(
    () => useCase.execute(5, 10),
    { status: 404, code: "REGISTRATION_NOT_FOUND" },
  );
});

test("returns 422 when registration is already cancelled", async () => {
  const { useCase } = makeUseCase({
    registrationRow: registration({ status: "cancelled" }),
  });

  await assertHttpError(
    () => useCase.execute(5, 10),
    { status: 422, code: "REGISTRATION_ALREADY_CANCELLED" },
  );
});

test("returns 422 when event is ended", async () => {
  const { useCase } = makeUseCase({
    registrationRow: registration({
      starts_at: pastIso(2),
      ends_at: pastIso(1),
    }),
  });

  await assertHttpError(
    () => useCase.execute(5, 10),
    { status: 422, code: "EVENT_ENDED" },
  );
});

test("returns 404 when cancellation update affects no rows", async () => {
  const { useCase } = makeUseCase({
    registrationRow: registration(),
    cancelResult: 0,
  });

  await assertHttpError(
    () => useCase.execute(5, 10),
    { status: 404, code: "REGISTRATION_NOT_FOUND" },
  );
});
