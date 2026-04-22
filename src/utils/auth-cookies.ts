import type { Request, Response, CookieOptions } from "express";
import { env } from "../config/env";
import { accessExpiresInSeconds, refreshTtlMs } from "../use-cases/auth/auth-tokens.helper";

export const ACCESS_COOKIE_NAME = "amparian_access_token";
export const REFRESH_COOKIE_NAME = "amparian_refresh_token";

function cookieBaseOptions(): CookieOptions {
  const isProduction = env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  };
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, {
    ...cookieBaseOptions(),
    maxAge: accessExpiresInSeconds() * 1000,
  });
  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    ...cookieBaseOptions(),
    maxAge: refreshTtlMs(),
  });
}

export function clearAuthCookies(res: Response): void {
  const options = cookieBaseOptions();
  res.clearCookie(ACCESS_COOKIE_NAME, options);
  res.clearCookie(REFRESH_COOKIE_NAME, options);
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;

  const key = `${name}=`;
  const parts = raw.split(";");

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(key)) {
      return decodeURIComponent(trimmed.slice(key.length));
    }
  }

  return undefined;
}
