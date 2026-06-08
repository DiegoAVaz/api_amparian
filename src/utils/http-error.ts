export type ErrorFieldDetail = {
  path: string;
  code: string;
  message: string;
};

export type ErrorDetails =
  | {
      fields?: ErrorFieldDetail[];
      context?: Record<string, unknown>;
    }
  | Record<string, unknown>
  | unknown[]
  | null;

export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details: ErrorDetails;
  };
};

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetails;

  constructor(
    status: number,
    code: string,
    message: string,
    details: ErrorDetails = null,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toEnvelope(): ErrorEnvelope {
    return createErrorEnvelope(this.code, this.message, this.details);
  }
}

export function createErrorEnvelope(
  code: string,
  message: string,
  details: ErrorDetails = null,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      details,
    },
  };
}

export function httpError(
  status: number,
  code: string,
  message: string,
  details: ErrorDetails = null,
): HttpError {
  return new HttpError(status, code, message, details);
}

export function badRequest(
  code: string,
  message: string,
  details: ErrorDetails = null,
): HttpError {
  return httpError(400, code, message, details);
}

export function unauthorized(
  code: string,
  message: string,
  details: ErrorDetails = null,
): HttpError {
  return httpError(401, code, message, details);
}

export function forbidden(
  code: string,
  message: string,
  details: ErrorDetails = null,
): HttpError {
  return httpError(403, code, message, details);
}

export function notFound(
  code: string,
  message: string,
  details: ErrorDetails = null,
): HttpError {
  return httpError(404, code, message, details);
}

export function conflict(
  code: string,
  message: string,
  details: ErrorDetails = null,
): HttpError {
  return httpError(409, code, message, details);
}

export function unprocessableEntity(
  code: string,
  message: string,
  details: ErrorDetails = null,
): HttpError {
  return httpError(422, code, message, details);
}

export function tooManyRequests(
  code: string,
  message: string,
  details: ErrorDetails = null,
): HttpError {
  return httpError(429, code, message, details);
}

export function internalServerError(
  code = "INTERNAL_ERROR",
  message = "Erro interno",
  details: ErrorDetails = null,
): HttpError {
  return httpError(500, code, message, details);
}
