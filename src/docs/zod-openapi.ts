import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

function formatValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "string") {
    return value;
  }

  return "valor informado";
}

function defaultPortugueseError(issue: {
  code?: string;
  expected?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  format?: unknown;
  keys?: unknown;
}): string {
  switch (issue.code) {
    case "invalid_type":
      return "Tipo de dado inválido";
    case "invalid_format":
      if (issue.format === "email") {
        return "E-mail inválido";
      }
      if (issue.format === "url") {
        return "URL inválida";
      }
      if (issue.format === "datetime") {
        return "Data e hora inválidas";
      }
      return "Formato inválido";
    case "too_small":
      return `Valor menor que o mínimo permitido: ${formatValue(issue.minimum)}`;
    case "too_big":
      return `Valor maior que o máximo permitido: ${formatValue(issue.maximum)}`;
    case "invalid_value":
      return "Valor inválido";
    case "unrecognized_keys":
      return "Campo não reconhecido";
    case "invalid_union":
      return "Valor não corresponde a nenhum formato aceito";
    default:
      return "Dados inválidos";
  }
}

z.config({
  customError: defaultPortugueseError,
});

extendZodWithOpenApi(z);

export { z };
