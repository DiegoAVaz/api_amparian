import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcrypt";
import {
  ForgotPasswordUseCase,
  LoginUserUseCase,
  LogoutUserUseCase,
  RefreshSessionUseCase,
  RegisterUserUseCase,
  ResetPasswordUseCase,
} from "../../src/use-cases/auth/auth.use-cases";
import { sha256Hex } from "../../src/utils/hash";
import { assertHttpError, futureIso, pastIso } from "../helpers";

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: "user@example.com",
    password_hash: "hash",
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

test("register creates user and returns session without password hash", async () => {
  const inserted: unknown[] = [];
  const users = {
    emailExists: async () => false,
    insertUser: async (input: unknown) => {
      inserted.push(input);
      return 10;
    },
    findById: async () => user({ id: 10, email: "new@example.com", phone: "11999999999" }),
  };
  const tokens = {
    createPair: async (userId: number) => ({
      accessToken: `access-${userId}`,
      refreshToken: `refresh-${userId}`,
      expiresIn: 900,
    }),
  };

  const result = await new RegisterUserUseCase(users as never, tokens as never).execute({
    email: "new@example.com",
    password: "Senha@123",
    name: "Novo Usuario",
    phone: "11999999999",
  });

  assert.equal(result.accessToken, "access-10");
  assert.equal(result.refreshToken, "refresh-10");
  assert.equal(result.user.id, 10);
  assert.equal("password_hash" in result.user, false);
  assert.equal((inserted[0] as { email: string }).email, "new@example.com");
  assert.equal((inserted[0] as { phone: string }).phone, "11999999999");
  assert.ok((inserted[0] as { password_hash: string }).password_hash.length > 0);
});

test("register returns 409 when email already exists or duplicate insert happens", async () => {
  await assertHttpError(
    () =>
      new RegisterUserUseCase(
        {
          emailExists: async () => true,
        } as never,
        {} as never,
      ).execute({
        email: "exists@example.com",
        password: "Senha@123",
        name: "Usuario",
      }),
    { status: 409, code: "EMAIL_EXISTS" },
  );

  await assertHttpError(
    () =>
      new RegisterUserUseCase(
        {
          emailExists: async () => false,
          insertUser: async () => {
            throw { code: "ER_DUP_ENTRY", sqlMessage: "users.email" };
          },
        } as never,
        {} as never,
      ).execute({
        email: "race@example.com",
        password: "Senha@123",
        name: "Usuario",
      }),
    { status: 409, code: "EMAIL_EXISTS" },
  );
});

test("login returns session for valid credentials and 401 otherwise", async () => {
  const password_hash = await bcrypt.hash("Senha@123", 10);
  const tokens = {
    createPair: async (userId: number) => ({
      accessToken: `access-${userId}`,
      refreshToken: `refresh-${userId}`,
      expiresIn: 900,
    }),
  };

  const result = await new LoginUserUseCase(
    {
      findByEmailWithPassword: async () => user({ password_hash }),
    } as never,
    tokens as never,
  ).execute({ email: "user@example.com", password: "Senha@123" });

  assert.equal(result.accessToken, "access-1");
  assert.equal(result.user.email, "user@example.com");
  assert.equal("password_hash" in result.user, false);

  await assertHttpError(
    () =>
      new LoginUserUseCase(
        { findByEmailWithPassword: async () => undefined } as never,
        tokens as never,
      ).execute({ email: "missing@example.com", password: "Senha@123" }),
    { status: 401, code: "INVALID_CREDENTIALS" },
  );

  await assertHttpError(
    () =>
      new LoginUserUseCase(
        { findByEmailWithPassword: async () => user({ password_hash }) } as never,
        tokens as never,
      ).execute({ email: "user@example.com", password: "Senha@999" }),
    { status: 401, code: "INVALID_CREDENTIALS" },
  );
});

test("refresh rotates refresh token and rejects invalid sessions", async () => {
  const inserted: unknown[] = [];
  let revokedId: number | null = null;
  const refreshTokens = {
    findByHash: async (token_hash: string) =>
      token_hash === sha256Hex("valid-refresh")
        ? { id: 33, user_id: 7, expires_at: futureIso(), revoked_at: null }
        : undefined,
    revokeById: async (id: number) => {
      revokedId = id;
    },
    insert: async (input: unknown) => {
      inserted.push(input);
    },
  };

  const result = await new RefreshSessionUseCase(refreshTokens as never).execute("valid-refresh", {
    userAgent: "test-agent",
    ip: "127.0.0.1",
  });

  assert.equal(revokedId, 33);
  assert.equal(result.expiresIn > 0, true);
  assert.equal(typeof result.accessToken, "string");
  assert.equal(typeof result.refreshToken, "string");
  assert.equal((inserted[0] as { user_id: number }).user_id, 7);
  assert.equal((inserted[0] as { user_agent: string }).user_agent, "test-agent");

  await assertHttpError(
    () => new RefreshSessionUseCase(refreshTokens as never).execute("invalid-refresh"),
    { status: 401, code: "INVALID_REFRESH" },
  );

  await assertHttpError(
    () =>
      new RefreshSessionUseCase({
        findByHash: async () => ({ id: 1, user_id: 7, expires_at: pastIso(), revoked_at: null }),
      } as never).execute("expired-refresh"),
    { status: 401, code: "INVALID_REFRESH" },
  );
});

test("logout revokes refresh token when one is provided", async () => {
  let revokedHash: string | undefined;
  const useCase = new LogoutUserUseCase({
    revokeByHash: async (token_hash: string) => {
      revokedHash = token_hash;
    },
  } as never);

  await useCase.execute(undefined);
  assert.equal(revokedHash, undefined);

  await useCase.execute("refresh-token");
  assert.equal(revokedHash, sha256Hex("refresh-token"));
});

test("forgot password stores reset token only for existing users", async () => {
  const inserted: unknown[] = [];
  const passwordReset = {
    insert: async (input: unknown) => {
      inserted.push(input);
    },
  };

  await new ForgotPasswordUseCase(
    { findByEmailWithPassword: async () => undefined } as never,
    passwordReset as never,
  ).execute("missing@example.com");
  assert.equal(inserted.length, 0);

  const originalInfo = console.info;
  console.info = () => undefined;
  try {
    await new ForgotPasswordUseCase(
      { findByEmailWithPassword: async () => user({ id: 12 }) } as never,
      passwordReset as never,
    ).execute("user@example.com");
  } finally {
    console.info = originalInfo;
  }

  assert.equal(inserted.length, 1);
  assert.equal((inserted[0] as { user_id: number }).user_id, 12);
  assert.equal(typeof (inserted[0] as { token_hash: string }).token_hash, "string");
});

test("reset password rejects invalid tokens and revokes sessions for valid token", async () => {
  await assertHttpError(
    () =>
      new ResetPasswordUseCase(
        { findByHash: async () => undefined } as never,
        {} as never,
      ).execute("missing-token", "Senha@123"),
    { status: 401, code: "INVALID_RESET_TOKEN" },
  );

  await assertHttpError(
    () =>
      new ResetPasswordUseCase(
        { findByHash: async () => ({ id: 1, user_id: 2, expires_at: futureIso(), used_at: new Date() }) } as never,
        {} as never,
      ).execute("used-token", "Senha@123"),
    { status: 401, code: "INVALID_RESET_TOKEN" },
  );

  await assertHttpError(
    () =>
      new ResetPasswordUseCase(
        { findByHash: async () => ({ id: 1, user_id: 2, expires_at: pastIso(), used_at: null }) } as never,
        {} as never,
      ).execute("expired-token", "Senha@123"),
    { status: 401, code: "INVALID_RESET_TOKEN" },
  );

  const updates: Array<{ table: string; where: unknown[]; update: Record<string, unknown> }> = [];
  const trx = Object.assign(
    (table: string) => {
      const where: unknown[] = [];
      const chain = {
        where(condition: unknown) {
          where.push(condition);
          return chain;
        },
        whereNull(column: string) {
          where.push({ [`${column}:null`]: true });
          return chain;
        },
        async update(row: Record<string, unknown>) {
          updates.push({ table, where, update: row });
        },
      };
      return chain;
    },
    { fn: { now: () => "now" } },
  );
  const db = {
    transaction: async (fn: (trxArg: typeof trx) => Promise<void>) => fn(trx),
  };

  await new ResetPasswordUseCase(
    { findByHash: async () => ({ id: 5, user_id: 8, expires_at: futureIso(), used_at: null }) } as never,
    db as never,
  ).execute("valid-token", "Senha@123");

  assert.equal(updates.length, 3);
  assert.equal(updates[0].table, "users");
  assert.equal(typeof updates[0].update.password_hash, "string");
  assert.equal(updates[1].table, "password_reset_tokens");
  assert.deepEqual(updates[1].update, { used_at: "now" });
  assert.equal(updates[2].table, "refresh_tokens");
  assert.deepEqual(updates[2].update, { revoked_at: "now" });
});
