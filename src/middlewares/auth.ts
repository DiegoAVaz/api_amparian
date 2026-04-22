import type { NextFunction, Request, Response } from "express";
import { readCookie, ACCESS_COOKIE_NAME } from "../utils/auth-cookies";
import { verifyAccessToken } from "../utils/jwt";
import { HttpError } from "../utils/http-error";

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const cookieToken = readCookie(req, ACCESS_COOKIE_NAME);
  const token = bearerToken ?? cookieToken;

  if (!token) {
    next(new HttpError(401, "UNAUTHORIZED", "Autenticação necessária"));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    next(new HttpError(401, "UNAUTHORIZED", "Token inválido ou expirado"));
  }
}
