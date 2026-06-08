import type { ZodError } from "zod";
import type { ErrorFieldDetail } from "./http-error";

export type ZodValidationDetails = {
  fields: ErrorFieldDetail[];
};

function formatIssuePath(path: PropertyKey[], rootPath: string): string {
  if (path.length === 0) {
    return rootPath;
  }

  return path.map(String).join(".");
}

export function formatZodValidationDetails(
  error: ZodError,
  rootPath = "body",
): ZodValidationDetails {
  return {
    fields: error.issues.map((issue) => ({
      path: formatIssuePath(issue.path, rootPath),
      code: issue.code,
      message: issue.message,
    })),
  };
}
