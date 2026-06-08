import assert from "node:assert/strict";
import type { HttpError } from "../src/utils/http-error";

export async function assertHttpError(
  action: () => Promise<unknown>,
  expected: { status: number; code: string },
): Promise<HttpError> {
  try {
    await action();
  } catch (error) {
    const httpError = error as HttpError;
    assert.equal(httpError.status, expected.status);
    assert.equal(httpError.code, expected.code);
    return httpError;
  }

  assert.fail(`Expected HttpError ${expected.status} ${expected.code}`);
}

export function futureIso(days = 1): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function pastIso(days = 1): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
