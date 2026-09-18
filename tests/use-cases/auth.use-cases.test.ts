import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcrypt";
import { renderPasswordResetEmail } from "../../src/services/mail/templates/password-reset.template";
import { AuthTokensHelper } from "../../src/use-cases/auth/auth-tokens.helper";
import {
  ForgotPasswordUseCase,
  LoginUserUseCase,
  LogoutUserUseCase,
  RefreshSessionUseCase,
  RegisterUserUseCase,
  ResetPasswordUseCase,
} from "../../src/use-cases/auth/auth.use-cases";
import { sha256Hex } from "../../src/utils/hash";
import { assertHttpError, futureIso, pastIso, fakePublicUrl } from "../helpers";

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

  const result = await new RegisterUserUseCase(users as never, tokens as never, fakePublicUrl).execute({
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
       fakePublicUrl).execute({
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
       fakePublicUrl).execute({
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
   fakePublicUrl).execute({ email: "user@example.com", password: "Senha@123" });

  assert.equal(result.accessToken, "access-1");
  assert.equal(result.user.email, "user@example.com");
  assert.equal("password_hash" in result.user, false);

  await assertHttpError(
    () =>
      new LoginUserUseCase(
        { findByEmailWithPassword: async () => undefined } as never,
        tokens as never,
       fakePublicUrl).execute({ email: "missing@example.com", password: "Senha@123" }),
    { status: 401, code: "INVALID_CREDENTIALS" },
  );

  await assertHttpError(
    () =>
      new LoginUserUseCase(
        { findByEmailWithPassword: async () => user({ password_hash }) } as never,
        tokens as never,
       fakePublicUrl).execute({ email: "user@example.com", password: "Senha@999" }),
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

  // O helper é injetado: o caso de uso não assina JWT nem lê duração de
  // ambiente, então o teste não depende de segredo nem de `.env`.
  const tokens = new AuthTokensHelper(
    refreshTokens as never,
    (userId) => `access-${userId}`,
    { refreshTtlMs: 7 * 24 * 60 * 60 * 1000, accessTtlSeconds: 900 },
  );

  const result = await new RefreshSessionUseCase(refreshTokens as never, tokens).execute(
    "valid-refresh",
    { userAgent: "test-agent", ip: "127.0.0.1" },
  );

  assert.equal(revokedId, 33);
  assert.equal(result.expiresIn, 900);
  assert.equal(result.accessToken, "access-7");
  assert.equal(typeof result.refreshToken, "string");
  assert.equal((inserted[0] as { user_id: number }).user_id, 7);
  assert.equal((inserted[0] as { user_agent: string }).user_agent, "test-agent");
  assert.equal((inserted[0] as { ip_address: string }).ip_address, "127.0.0.1");
  // O refresh gravado é o hash, nunca o valor devolvido ao cliente.
  assert.equal((inserted[0] as { token_hash: string }).token_hash, sha256Hex(result.refreshToken));

  await assertHttpError(
    () => new RefreshSessionUseCase(refreshTokens as never, tokens).execute("invalid-refresh"),
    { status: 401, code: "INVALID_REFRESH" },
  );

  await assertHttpError(
    () =>
      new RefreshSessionUseCase(
        {
          findByHash: async () => ({ id: 1, user_id: 7, expires_at: pastIso(), revoked_at: null }),
        } as never,
        tokens,
      ).execute("expired-refresh"),
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

type InsertedToken = { user_id: number; token_hash: string; expires_at: Date };
type SentMail = { to: string; subject: string; html: string; text: string };

// Configuração fixada aqui, não lida do ambiente: o caso de uso a recebe do
// container, então o teste é determinístico e independe de qualquer `.env`.
// Valores propositalmente diferentes de qualquer default do projeto — um
// teste que passa só porque o default coincide não está testando nada.
const RESET_CONFIG = {
  webUrl: "https://front.test/app",
  tokenTtlMs: 45 * 60 * 1000,
};

/**
 * Fakes com registro de ordem: a invalidação precisa acontecer antes da
 * inserção, senão o token recém-criado seria queimado junto com os antigos.
 */
function forgotPasswordHarness(
  options: { row?: unknown; mailerFails?: boolean; config?: typeof RESET_CONFIG } = {},
) {
  const calls: string[] = [];
  const inserted: InsertedToken[] = [];
  const sent: SentMail[] = [];
  const invalidated: number[] = [];

  const useCase = new ForgotPasswordUseCase(
    {
      findByEmailWithPassword: async () => options.row,
    } as never,
    {
      invalidateActiveByUserId: async (userId: number) => {
        calls.push("invalidate");
        invalidated.push(userId);
      },
      insert: async (input: InsertedToken) => {
        calls.push("insert");
        inserted.push(input);
      },
    } as never,
    {
      send: async (message: SentMail) => {
        calls.push("send");
        // Registra antes de falhar, para o teste de falha ainda poder
        // inspecionar o token que teria sido enviado.
        sent.push(message);
        if (options.mailerFails) throw new Error("SMTP fora do ar");
      },
    } as never,
    options.config ?? RESET_CONFIG,
  );

  return { useCase, calls, inserted, sent, invalidated };
}

/** Extrai o link de redefinição do corpo em texto puro do e-mail. */
function urlFromMail(mail: SentMail): URL {
  const found = mail.text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(found, "o corpo em texto puro precisa conter a URL de redefinição");
  return new URL(found);
}

function tokenFromMail(mail: SentMail): string {
  return urlFromMail(mail).searchParams.get("token") ?? "";
}

/** "1 hora", extraído do aviso de expiração no corpo do e-mail. */
function validityPhrase(text: string): string | undefined {
  return text.match(/vale por (.+?) e pode/)?.[1];
}

test("forgot password does nothing at all for an unknown e-mail", async () => {
  const h = forgotPasswordHarness({ row: undefined });

  await h.useCase.execute("missing@example.com");

  // Nem escrita nem envio: qualquer efeito colateral observável viraria um
  // canal para descobrir quais endereços têm conta.
  assert.deepEqual(h.calls, []);
  assert.equal(h.inserted.length, 0);
  assert.equal(h.sent.length, 0);
  assert.equal(h.invalidated.length, 0);
});

test("forgot password invalidates previous tokens before issuing a new one", async () => {
  const h = forgotPasswordHarness({ row: user({ id: 12 }) });

  await h.useCase.execute("user@example.com");

  assert.deepEqual(h.calls, ["invalidate", "insert", "send"]);
  assert.deepEqual(h.invalidated, [12]);
  assert.equal(h.inserted[0].user_id, 12);
});

test("forgot password e-mails the very token whose hash was stored", async () => {
  const h = forgotPasswordHarness({
    row: user({ id: 12, email: "alvo@example.com", name: "Ana Paula" }),
  });

  await h.useCase.execute("alvo@example.com");

  const token = tokenFromMail(h.sent[0]);

  // A asserção central do fluxo: se o token enviado não corresponder ao hash
  // gravado, todo link chega quebrado e nada mais neste teste denunciaria.
  // Entropia junto: um token curto continuaria passando por todo o resto do
  // teste, e seria adivinhável por força bruta dentro da janela do TTL.
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(sha256Hex(token), h.inserted[0].token_hash);

  // E o token em claro não pode ter sido persistido em nenhum campo.
  assert.ok(!JSON.stringify(h.inserted[0]).includes(token));
});

test("forgot password sends to the stored address and links to the configured front", async () => {
  const h = forgotPasswordHarness({
    row: user({ id: 12, email: "alvo@example.com", name: "Ana Paula" }),
  });

  await h.useCase.execute("  ALVO@example.com  ");

  const mail = h.sent[0];
  // Endereço vem do banco, não do que foi digitado na requisição.
  assert.equal(mail.to, "alvo@example.com");
  assert.match(mail.subject, /senha/i);
  assert.match(mail.text, /Ana/);

  // A base do link vem da configuração injetada, que inclui um subcaminho de
  // propósito: um `webUrl` ignorado ou trocado por localhost quebra aqui.
  assert.ok(
    urlFromMail(mail).href.startsWith(
      `${RESET_CONFIG.webUrl}/esqueci-minha-senha/redefinir?`,
    ),
  );

  // O prazo anunciado no e-mail tem que sair do mesmo TTL que grava o
  // expires_at. Uma conversão errada de minutos prometeria "45 horas" para um
  // link de 45 minutos, e nenhuma outra asserção notaria.
  const expected = renderPasswordResetEmail({
    name: "Ana Paula",
    resetUrl: "https://exemplo.test/x",
    expiresInMinutes: RESET_CONFIG.tokenTtlMs / 60_000,
  });
  const phrase = validityPhrase(mail.text);
  // Sem este ok, reescrever o aviso no template faria os dois lados virarem
  // undefined e a comparação passaria sem comparar nada.
  assert.ok(phrase, "o aviso de expiração precisa estar no corpo do e-mail");
  assert.equal(phrase, validityPhrase(expected.text));
});

test("forgot password derives the expiry from the injected TTL", async () => {
  const h = forgotPasswordHarness({ row: user({ id: 12 }) });

  const before = Date.now();
  await h.useCase.execute("user@example.com");
  const after = Date.now();

  // 45 minutos vem da configuração injetada, não de nenhuma variável de
  // ambiente: cravar 60 * 60 * 1000 no caso de uso falha aqui.
  const expiresAt = h.inserted[0].expires_at.getTime();
  assert.ok(expiresAt >= before + RESET_CONFIG.tokenTtlMs);
  assert.ok(expiresAt <= after + RESET_CONFIG.tokenTtlMs);
});

test("forgot password tolerates a trailing slash in the configured base URL", async () => {
  // O container hoje entrega sem barra, mas o seam é público: um segundo
  // chamador com barra final geraria `//esqueci-minha-senha`, que não roteia.
  const h = forgotPasswordHarness({
    row: user({ id: 12 }),
    config: { ...RESET_CONFIG, webUrl: `${RESET_CONFIG.webUrl}///` },
  });

  await h.useCase.execute("user@example.com");

  assert.ok(
    urlFromMail(h.sent[0]).href.startsWith(
      `${RESET_CONFIG.webUrl}/esqueci-minha-senha/redefinir?`,
    ),
  );
});

test("forgot password issues a distinct token on every request", async () => {
  const h = forgotPasswordHarness({ row: user({ id: 12 }) });

  await h.useCase.execute("user@example.com");
  await h.useCase.execute("user@example.com");

  assert.notEqual(h.inserted[0].token_hash, h.inserted[1].token_hash);
  assert.notEqual(tokenFromMail(h.sent[0]), tokenFromMail(h.sent[1]));
});

test("forgot password survives a mailer failure without leaking it to the caller", async () => {
  const h = forgotPasswordHarness({ row: user({ id: 12 }), mailerFails: true });

  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    // Não pode lançar: o controller responde 202 mesmo assim, para não
    // revelar que o endereço existe.
    await h.useCase.execute("user@example.com");
  } finally {
    console.error = originalError;
  }

  assert.equal(h.inserted.length, 1);
  assert.equal(logged.length, 1);

  // O log não pode conter o token em claro, que é a credencial de
  // redefinição — nem o hash, que identifica a linha no banco.
  const line = logged[0].map((part) => String(part)).join(" ");
  assert.ok(line.includes("userId=12"));
  assert.ok(!line.includes(tokenFromMail(h.sent[0])));
  assert.ok(!line.includes(h.inserted[0].token_hash));
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
