import ms from "ms";
import { env } from "../../config/env";
import type { RefreshTokenRepository } from "../../repositories/refresh-token.repository";
import { randomToken, sha256Hex } from "../../utils/hash";
import { signAccessToken } from "../../utils/jwt";

function msDuration(expr: string): number {
  const v = (ms as (s: string) => number | undefined)(expr);
  if (typeof v !== "number") throw new Error("Duração JWT inválida");
  return v;
}

export function refreshTtlMs(): number {
  return msDuration(env.JWT_REFRESH_EXPIRES_IN);
}

export function accessExpiresInSeconds(): number {
  return Math.floor(msDuration(env.JWT_ACCESS_EXPIRES_IN) / 1000);
}

export class AuthTokensHelper {
  constructor(private readonly refreshTokens: RefreshTokenRepository) {}

  async createPair(userId: number): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const accessToken = signAccessToken(userId);
    const plainRefresh = randomToken(48);
    const token_hash = sha256Hex(plainRefresh);
    const expiresAt = new Date(Date.now() + refreshTtlMs());

    await this.refreshTokens.insert({
      user_id: userId,
      token_hash,
      expires_at: expiresAt,
    });

    return {
      accessToken,
      refreshToken: plainRefresh,
      expiresIn: accessExpiresInSeconds(),
    };
  }
}
