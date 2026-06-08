import type { ZodType } from "zod";
import { HttpError } from "./http-error";
import { formatZodValidationDetails } from "./zod-error";

type RequestValidationSource = "body" | "query" | "params";

const validationErrorBySource: Record<
  RequestValidationSource,
  { status: number; code: string; message: string }
> = {
  body: {
    status: 400,
    code: "INVALID_REQUEST_BODY",
    message: "Dados da requisição inválidos",
  },
  query: {
    status: 400,
    code: "INVALID_REQUEST_QUERY",
    message: "Parâmetros de consulta inválidos",
  },
  params: {
    status: 400,
    code: "INVALID_ROUTE_PARAMS",
    message: "Parâmetros da rota inválidos",
  },
};

function parseRequestPart<T>(
  source: RequestValidationSource,
  schema: ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const error = validationErrorBySource[source];
  throw new HttpError(error.status, error.code, error.message, {
    ...formatZodValidationDetails(result.error, source),
    context: { source },
  });
}

export function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  return parseRequestPart("body", schema, value);
}

export function parseQuery<T>(schema: ZodType<T>, value: unknown): T {
  return parseRequestPart("query", schema, value);
}

export function parseParams<T>(schema: ZodType<T>, value: unknown): T {
  return parseRequestPart("params", schema, value);
}
