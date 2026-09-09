import bcrypt from "bcrypt";
import { toUserPublicDto } from "../../models/user.model";
import type { PublicUrlResolver } from "../../services/storage";
import type { PasswordResetRepository } from "../../repositories/password-reset.repository";
import type { RefreshTokenRepository } from "../../repositories/refresh-token.repository";
import type { UserRepository } from "../../repositories/user.repository";
import type { Mailer } from "../../services/mail/mailer";
import { renderPasswordResetEmail } from "../../services/mail/templates/password-reset.template";
import { randomToken, sha256Hex } from "../../utils/hash";
import { HttpError } from "../../utils/http-error";
import { isExpired } from "../../utils/knex-helpers";
import type { AuthTokensHelper } from "./auth-tokens.helper";

function isDuplicateEmailError(error: unknown): boolean {
  const err = error as {
    code?: unknown;
    errno?: unknown;
    sqlMessage?: unknown;
  };
  return (
    err.code === "ER_DUP_ENTRY" ||
    err.errno === 1062 ||
    (typeof err.sqlMessage === "string" &&
      err.sqlMessage.includes("users.email"))
  );
}

export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokensHelper,
      private readonly resolvePublicUrl: PublicUrlResolver,
  ) {}

  async execute(input: {
    email: string;
    password: string;
    name: string;
    phone?: string;
  }) {
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
    return { ...pair, user: toUserPublicDto(user, this.resolvePublicUrl) };
  }
}

export class LoginUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokensHelper,
    private readonly resolvePublicUrl: PublicUrlResolver,
  ) {}

  async execute(input: { email: string; password: string }) {
    const row = await this.users.findByEmailWithPassword(input.email);
    if (!row)
      throw new HttpError(
        401,
        "INVALID_CREDENTIALS",
        "E-mail ou senha incorretos",
      );

    const ok = await bcrypt.compare(input.password, row.password_hash);
    if (!ok)
      throw new HttpError(
        401,
        "INVALID_CREDENTIALS",
        "E-mail ou senha incorretos",
      );

    const pair = await this.tokens.createPair(row.id);
    const { password_hash: _, ...publicFields } = row;
    return { ...pair, user: toUserPublicDto(publicFields, this.resolvePublicUrl) };
  }
}

export class RefreshSessionUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: AuthTokensHelper,
  ) {}

  async execute(
    refreshToken: string,
    meta?: { userAgent?: string; ip?: string },
  ) {
    const token_hash = sha256Hex(refreshToken);
    const row = await this.refreshTokens.findByHash(token_hash);
    if (!row || row.revoked_at)
      throw new HttpError(401, "INVALID_REFRESH", "Refresh inválido");

    if (isExpired(row.expires_at))
      throw new HttpError(401, "INVALID_REFRESH", "Refresh expirado");

    await this.refreshTokens.revokeById(row.id);
    return this.tokens.createPair(row.user_id, meta);
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

export type PasswordResetConfig = {
  /** Base do link enviado no e-mail. Barra final é tolerada. */
  webUrl: string;
  tokenTtlMs: number;
};

export class ForgotPasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordReset: PasswordResetRepository,
    private readonly mailer: Mailer,
    private readonly config: PasswordResetConfig,
  ) {}

  async execute(email: string): Promise<void> {
    const row = await this.users.findByEmailWithPassword(email);

    if (!row) return;

    await this.passwordReset.invalidateActiveByUserId(row.id);

    const plain = randomToken(32);
    const token_hash = sha256Hex(plain);
    const { tokenTtlMs } = this.config;

    await this.passwordReset.insert({
      user_id: row.id,
      token_hash,
      expires_at: new Date(Date.now() + tokenTtlMs),
    });

    const base = this.config.webUrl.replace(/\/+$/, "");
    const resetUrl = `${base}/esqueci-minha-senha/redefinir?token=${encodeURIComponent(plain)}`;
    const message = renderPasswordResetEmail({
      name: row.name,
      resetUrl,
      expiresInMinutes: tokenTtlMs / 60_000,
    });

    try {
      await this.mailer.send({ to: row.email, ...message });
    } catch (error) {
      console.error(
        `[mail] falha ao enviar e-mail de recuperação de senha (userId=${row.id})`,
        error,
      );
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
    if (!row || row.used_at) {
      throw new HttpError(
        401,
        "INVALID_RESET_TOKEN",
        "Token de recuperação inválido ou expirado",
      );
    }
    if (isExpired(row.expires_at)) {
      throw new HttpError(
        401,
        "INVALID_RESET_TOKEN",
        "Token de recuperação inválido ou expirado",
      );
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await this.db.transaction(async (trx) => {
      await trx("users").where({ id: row.user_id }).update({ password_hash });
      await trx("password_reset_tokens")
        .where({ id: row.id })
        .update({ used_at: trx.fn.now() });
      await trx("refresh_tokens")
        .where({ user_id: row.user_id })
        .whereNull("revoked_at")
        .update({ revoked_at: trx.fn.now() });
    });
  }
}
