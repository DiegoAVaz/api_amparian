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

test("profile stats returns aggregated application metrics", async () => {
  const result = await new GetProfileStatsUseCase(
    { findById: async () => user() } as never,
    { countByOrganizer: async () => 3 } as never,
    {
      countConfirmedRegistrationsByUser: async () => 7,
      countDistinctCausesSupported: async () => 4,
    } as never,
  ).execute(1);

  assert.deepEqual(result, {
    hoursDonated: 0,
    causesSupported: 4,
    eventsAttended: 7,
    eventsCreated: 3,
  });
});

test("profile stats returns 404 when user does not exist", async () => {
  await assertHttpError(
    () =>
      new GetProfileStatsUseCase(
        { findById: async () => undefined } as never,
        { countByOrganizer: async () => 0 } as never,
        {
          countConfirmedRegistrationsByUser: async () => 0,
          countDistinctCausesSupported: async () => 0,
        } as never,
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
