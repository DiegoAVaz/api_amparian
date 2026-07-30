import ms from "ms";
import { getEnv } from "../../config/env";
import type { RefreshTokenRepository } from "../../repositories/refresh-token.repository";
import { randomToken, sha256Hex } from "../../utils/hash";

function msDuration(expr: string, variable: string): number {
  const v = (ms as (s: string) => number | undefined)(expr);
  if (typeof v !== "number") throw new Error(`Duração inválida em ${variable}`);
  return v;
}

export function refreshTtlMs(): number {
  return msDuration(getEnv().JWT_REFRESH_EXPIRES_IN, "JWT_REFRESH_EXPIRES_IN");
}

export function accessExpiresInSeconds(): number {
  return Math.floor(
    msDuration(getEnv().JWT_ACCESS_EXPIRES_IN, "JWT_ACCESS_EXPIRES_IN") / 1000,
  );
}

export function passwordResetTtlMs(): number {
  return msDuration(getEnv().PASSWORD_RESET_EXPIRES_IN, "PASSWORD_RESET_EXPIRES_IN");
}

/**
 * Porta para a assinatura do access token. Recebida em vez de importada para
 * que o segredo JWT — e portanto o ambiente — fique fora deste grafo.
 */
export type AccessTokenSigner = (userId: number) => string;

/** Durações resolvidas pelo container, não lidas do ambiente aqui. */
export type AuthTokensConfig = {
  refreshTtlMs: number;
  accessTtlSeconds: number;
};

export class AuthTokensHelper {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly signAccessToken: AccessTokenSigner,
    private readonly config: AuthTokensConfig,
  ) {}

  async createPair(
    userId: number,
    meta?: { userAgent?: string; ip?: string },
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const accessToken = this.signAccessToken(userId);
    const plainRefresh = randomToken(48);
    const token_hash = sha256Hex(plainRefresh);

    await this.refreshTokens.insert({
      user_id: userId,
      token_hash,
      expires_at: new Date(Date.now() + this.config.refreshTtlMs),
      user_agent: meta?.userAgent ?? null,
      ip_address: meta?.ip ?? null,
    });

    return {
      accessToken,
      refreshToken: plainRefresh,
      expiresIn: this.config.accessTtlSeconds,
    };
  }
}
