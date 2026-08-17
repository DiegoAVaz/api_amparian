import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer, { MulterError } from "multer";
import { getEnv } from "../config/env";
import { formatSizeLimit } from "../services/storage/image-validation";
import { HttpError, httpError } from "../utils/http-error";

export const UPLOAD_FIELD_NAME = "file";

export function uploadLimits(maxBytes: number) {
  return {
    fileSize: maxBytes,
    files: 1,
    fields: 0,
  };
}

export function toUploadHttpError(error: unknown, maxBytes: number): unknown {
  if (!(error instanceof MulterError)) return error;

  const details = { context: { limit: error.code } };

  switch (error.code) {
    case "LIMIT_FILE_SIZE":
      return httpError(
        413,
        "FILE_TOO_LARGE",
        `A imagem deve ter no máximo ${formatSizeLimit(maxBytes)}`,
        details,
      );

    case "LIMIT_UNEXPECTED_FILE":
      return httpError(
        400,
        "UNEXPECTED_FILE",
        `Envie o arquivo no campo "${UPLOAD_FIELD_NAME}"`,
        details,
      );

    case "LIMIT_FILE_COUNT":
    case "LIMIT_PART_COUNT":
    case "LIMIT_FIELD_COUNT":
      return httpError(
        400,
        "TOO_MANY_PARTS",
        "Envie apenas um arquivo, sem campos adicionais",
        details,
      );

    default:
      return httpError(
        400,
        "INVALID_UPLOAD",
        "Não foi possível ler o arquivo enviado",
        details,
      );
  }
}

function toClientError(error: unknown, maxBytes: number): HttpError {
  const translated = toUploadHttpError(error, maxBytes);
  if (translated instanceof HttpError) return translated;

  const motivo = error instanceof Error ? error.message : String(error);
  console.warn(`[upload] multipart ilegível: ${motivo}`);

  return httpError(
    400,
    "INVALID_UPLOAD",
    "Não foi possível ler o arquivo enviado",
    { context: { limit: "MALFORMED_MULTIPART" } },
  );
}

export function createUploadImage(maxBytes: number): RequestHandler {
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: uploadLimits(maxBytes),
  }).single(UPLOAD_FIELD_NAME);

  return (req: Request, res: Response, next: NextFunction): void => {
    parse(req, res, (error: unknown) => {
      if (error) {
        next(toClientError(error, maxBytes));
        return;
      }

      if (!req.file) {
        next(
          httpError(
            400,
            "MISSING_FILE",
            `Envie o arquivo como multipart/form-data no campo "${UPLOAD_FIELD_NAME}"`,
            { context: { limit: "MISSING_FILE" } },
          ),
        );
        return;
      }

      next();
    });
  };
}

let cached: RequestHandler | null = null;

export const uploadImage: RequestHandler = (req, res, next) => {
  if (!cached) cached = createUploadImage(getEnv().UPLOAD_MAX_BYTES);
  cached(req, res, next);
};

