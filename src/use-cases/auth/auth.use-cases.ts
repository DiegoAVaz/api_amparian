import bcrypt from "bcrypt";
import { env } from "../../config/env";
import { toUserPublicDto } from "../../models/user.model";
import type { PasswordResetRepository } from "../../repositories/password-reset.repository";
import type { RefreshTokenRepository } from "../../repositories/refresh-token.repository";
import type { UserRepository } from "../../repositories/user.repository";
import { randomToken, sha256Hex } from "../../utils/hash";
import { HttpError } from "../../utils/http-error";
import { signAccessToken } from "../../utils/jwt";
import { accessExpiresInSeconds, AuthTokensHelper, refreshTtlMs } from "./auth-tokens.helper";

function isDuplicateEmailError(error: unknown): boolean {
  const err = error as { code?: unknown; errno?: unknown; sqlMessage?: unknown };
  return (
    err.code === "ER_DUP_ENTRY"
    || err.errno === 1062
    || (typeof err.sqlMessage === "string" && err.sqlMessage.includes("users.email"))
  );
}

export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokensHelper,
  ) {}

  async execute(input: { email: string; password: string; name: string; phone?: string }) {
    if (await this.users.emailExists(input.email)) {
      throw new HttpError(409, "EMAIL_EXISTS", "E-mail já cadastrado");
    }
    const password_hash = await bcrypt.hash(input.password, 10);
    let userId: number;
    try {
      userId = await this.users.insertUser({
        email: input.email,
        password_hash,
        name: input.name,
        phone: input.phone ?? null,
      });
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        throw new HttpError(409, "EMAIL_EXISTS", "E-mail já cadastrado");
      }
      throw error;
    }
    const pair = await this.tokens.createPair(userId);
    const user = await this.users.findById(userId);
    if (!user) throw new HttpError(500, "INTERNAL", "Falha ao criar usuário");
    return { ...pair, user: toUserPublicDto(user) };
  }
}

export class LoginUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokensHelper,
  ) {}

  async execute(input: { email: string; password: string }) {
    const row = await this.users.findByEmailWithPassword(input.email);
    if (!row) throw new HttpError(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos");

    const ok = await bcrypt.compare(input.password, row.password_hash);
    if (!ok) throw new HttpError(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos");

    const pair = await this.tokens.createPair(row.id);
    const { password_hash: _, ...publicFields } = row;
    return { ...pair, user: toUserPublicDto(publicFields) };
  }
}

export class RefreshSessionUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(refreshToken: string, meta?: { userAgent?: string; ip?: string }) {
    const token_hash = sha256Hex(refreshToken);
    const row = await this.refreshTokens.findByHash(token_hash);
    if (!row || row.revoked_at) throw new HttpError(401, "INVALID_REFRESH", "Refresh inválido");

    if (new Date(row.expires_at) < new Date()) throw new HttpError(401, "INVALID_REFRESH", "Refresh expirado");

    await this.refreshTokens.revokeById(row.id);

    const accessToken = signAccessToken(row.user_id);
    const plainRefresh = randomToken(48);
    const newHash = sha256Hex(plainRefresh);
    const expiresAt = new Date(Date.now() + refreshTtlMs());

    await this.refreshTokens.insert({
      user_id: row.user_id,
      token_hash: newHash,
      expires_at: expiresAt,
      user_agent: meta?.userAgent ?? null,
      ip_address: meta?.ip ?? null,
    });

    return {
      accessToken,
      refreshToken: plainRefresh,
      expiresIn: accessExpiresInSeconds(),
    };
  }
}

export class LogoutUserUseCase {
  constructor(private readonly refreshTokens: RefreshTokenRepository) {}

  async execute(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const token_hash = sha256Hex(refreshToken);
    await this.refreshTokens.revokeByHash(token_hash);
  }
}

export class ForgotPasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordReset: PasswordResetRepository,
  ) {}

  async execute(email: string): Promise<void> {
    const row = await this.users.findByEmailWithPassword(email);
    if (!row) return;
    const plain = randomToken(32);
    const token_hash = sha256Hex(plain);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.passwordReset.insert({ user_id: row.id, token_hash, expires_at: expiresAt });
    if (env.NODE_ENV !== "production") {
      console.info("[dev] reset token para", email, plain);
    }
  }
}

export class ResetPasswordUseCase {
  constructor(
    private readonly passwordReset: PasswordResetRepository,
    private readonly db: import("knex").Knex,
  ) {}

  async execute(token: string, newPassword: string): Promise<void> {
    const token_hash = sha256Hex(token);
    const row = await this.passwordReset.findByHash(token_hash);
    if (!row || row.used_at) throw new HttpError(401, "INVALID_TOKEN", "Token inválido ou expirado");
    if (new Date(row.expires_at) < new Date()) throw new HttpError(401, "INVALID_TOKEN", "Token expirado");

    const password_hash = await bcrypt.hash(newPassword, 10);
    await this.db.transaction(async (trx) => {
      await trx("users").where({ id: row.user_id }).update({ password_hash });
      await trx("password_reset_tokens").where({ id: row.id }).update({ used_at: trx.fn.now() });
      await trx("refresh_tokens")
        .where({ user_id: row.user_id })
        .whereNull("revoked_at")
        .update({ revoked_at: trx.fn.now() });
    });
  }
}
