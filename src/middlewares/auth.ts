import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { HttpError } from "../utils/http-error";

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(new HttpError(401, "UNAUTHORIZED", "Autenticação necessária"));
    return;
  }

  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    next(new HttpError(401, "UNAUTHORIZED", "Token inválido ou expirado"));
  }
}
