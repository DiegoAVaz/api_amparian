import type { NextFunction, Request, Response } from "express";
import { TokenExpiredError } from "jsonwebtoken";
import { ZodError } from "zod";
import { createErrorEnvelope, HttpError } from "../utils/http-error";
import { formatZodValidationDetails } from "../utils/zod-error";

function isJsonParseError(err: unknown): boolean {
  return (
    err instanceof SyntaxError &&
    typeof (err as { status?: unknown }).status === "number" &&
    (err as { status?: unknown }).status === 400 &&
    "body" in err
  );
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json(err.toEnvelope());
    return;
  }
  if (isJsonParseError(err)) {
    res
      .status(400)
      .json(createErrorEnvelope("MALFORMED_JSON", "JSON malformado"));
    return;
  }
  if (err instanceof ZodError) {
    res
      .status(400)
      .json(
        createErrorEnvelope(
          "VALIDATION_ERROR",
          "Dados inválidos",
          formatZodValidationDetails(err),
        ),
      );
    return;
  }
  if (err instanceof Error && err.name === "JsonWebTokenError") {
    res.status(401).json(createErrorEnvelope("UNAUTHORIZED", "Token inválido"));
    return;
  }
  if (err instanceof TokenExpiredError) {
    res.status(401).json(createErrorEnvelope("TOKEN_EXPIRED", "Token expirado"));
    return;
  }
  console.error(err);
  res.status(500).json(createErrorEnvelope("INTERNAL_ERROR", "Erro interno"));
}
