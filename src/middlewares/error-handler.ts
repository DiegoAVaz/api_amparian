import type { NextFunction, Request, Response } from "express";
import { TokenExpiredError } from "jsonwebtoken";
import { z, ZodError } from "zod";
import { HttpError } from "../utils/http-error";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? null },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Dados inválidos",
        details: z.flattenError(err),
      },
    });
    return;
  }
  if (err instanceof Error && err.name === "JsonWebTokenError") {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Token inválido", details: null } });
    return;
  }
  if (err instanceof TokenExpiredError) {
    res.status(401).json({ error: { code: "TOKEN_EXPIRED", message: "Token expirado", details: null } });
    return;
  }
  console.error(err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Erro interno", details: null },
  });
}
