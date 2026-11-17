import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GetProfileStatsUseCase,
  GetProfileUseCase,
  UpdateProfileUseCase,
} from "../../src/use-cases/user/profile.use-cases";
import { assertHttpError, fakePublicUrl } from "../helpers";

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: "user@example.com",
    name: "Usuario",
    phone: null,
    city: null,
    state: null,
    bio: null,
    plan: "basic",
    public_organization_name: null,
    avatar_url: null,
    ...overrides,
  };
}

test("get profile returns public user dto", async () => {
  const result = await new GetProfileUseCase({
    findById: async () => user({ public_organization_name: "ONG Teste", avatar_url: "https://example.com/a.png" }),
  } as never, fakePublicUrl).execute(1);

  assert.deepEqual(result, {
    id: 1,
    email: "user@example.com",
    name: "Usuario",
    phone: null,
    city: null,
    state: null,
    bio: null,
    plan: "basic",
    publicOrganizationName: "ONG Teste",
    avatarUrl: "https://example.com/a.png",
  });
});

test("get profile returns 404 when user does not exist", async () => {
  await assertHttpError(
    () =>
      new GetProfileUseCase({
        findById: async () => undefined,
      } as never, fakePublicUrl).execute(1),
    { status: 404, code: "USER_NOT_FOUND" },
  );
});

test("update profile maps public fields to persisted columns", async () => {
  const updates: Array<{ userId: number; row: Record<string, unknown> }> = [];
  const users = {
    updateProfile: async (userId: number, row: Record<string, unknown>) => {
      updates.push({ userId, row });
    },
    findById: async () =>
      user({
        name: "Nome Novo",
        phone: "11999999999",
        city: "Sao Paulo",
        state: "SP",
        bio: "Bio",
        public_organization_name: "ONG Nova",
        avatar_url: "users/9/avatar-abc.png",
      }),
  };

  const result = await new UpdateProfileUseCase(users as never, fakePublicUrl).execute(9, {
    name: "Nome Novo",
    phone: "11999999999",
    city: "Sao Paulo",
    state: "SP",
    bio: "Bio",
    publicOrganizationName: "ONG Nova",
  });

  assert.deepEqual(updates, [
    {
      userId: 9,
      row: {
        name: "Nome Novo",
        phone: "11999999999",
        city: "Sao Paulo",
        state: "SP",
        bio: "Bio",
        public_organization_name: "ONG Nova",
      },
    },
  ]);
  assert.equal(result.publicOrganizationName, "ONG Nova");
  // O avatar não é mais gravável por aqui — saiu do contrato no api-3 — mas
  // continua sendo RESOLVIDO na resposta, a partir da chave já guardada.
  assert.equal(result.avatarUrl, "https://cdn.teste/users/9/avatar-abc.png");
});

test("update profile with empty patch returns current user without update", async () => {
  let updateCalled = false;
  const result = await new UpdateProfileUseCase({
    updateProfile: async () => {
      updateCalled = true;
    },
    findById: async () => user(),
  } as never, fakePublicUrl).execute(1, {});

  assert.equal(updateCalled, false);
  assert.equal(result.id, 1);
});

test("update profile returns 404 when updated user cannot be loaded", async () => {
  await assertHttpError(
    () =>
      new UpdateProfileUseCase({
        updateProfile: async () => undefined,
        findById: async () => undefined,
      } as never, fakePublicUrl).execute(1, { name: "Novo Nome" }),
    { status: 404, code: "USER_NOT_FOUND" },
  );
});

test("profile stats count every attended event and sum only the known workload", async () => {
  const askedFor: number[] = [];
  const result = await new GetProfileStatsUseCase(
    { findById: async () => user() } as never,
    { countByOrganizer: async () => 3 } as never,
    {
      listAttendedEventsByUser: async (userId: number) => {
        askedFor.push(userId);
        return [
          // Carga informada: vale ela.
          { organizer_id: 10, workload_hours: "2.50", starts_at: "2026-11-08T11:00:00.000Z", ends_at: "2026-11-08T21:00:00.000Z" },
          // Sem carga, um dia (8h às 12h em Brasília): 4 h pela duração.
          { organizer_id: 10, workload_hours: null, starts_at: "2026-11-09T11:00:00.000Z", ends_at: "2026-11-09T15:00:00.000Z" },
          // Sem carga, vários dias: conta como frequentado, soma 0 h.
          { organizer_id: 20, workload_hours: null, starts_at: "2026-11-06T12:00:00.000Z", ends_at: "2026-11-08T21:00:00.000Z" },
        ];
      },
    } as never,
  ).execute(1);

  assert.deepEqual(result, {
    hoursDonated: 6.5,
    causesSupported: 2,
    eventsAttended: 3,
    eventsCreated: 3,
  });
  assert.deepEqual(askedFor, [1]);
});

test("profile stats returns 404 when user does not exist", async () => {
  await assertHttpError(
    () =>
      new GetProfileStatsUseCase(
        { findById: async () => undefined } as never,
        { countByOrganizer: async () => 0 } as never,
        { listAttendedEventsByUser: async () => [] } as never,
      ).execute(1),
    { status: 404, code: "USER_NOT_FOUND" },
  );
});

// Mesma razão do teste equivalente em public-event: sem uma fixture com chave,
// remover o resolvedor de `toUserPublicDto` não quebraria nada.
test("o avatar guardado como chave sai como URL pública", async () => {
  const users = {
    findById: async () => user({ avatar_url: "users/9/avatar-xyz.png" }),
  };

  const perfil = await new GetProfileUseCase(
    users as never,
    fakePublicUrl,
  ).execute(9);

  assert.equal(perfil.avatarUrl, "https://cdn.teste/users/9/avatar-xyz.png");
});
