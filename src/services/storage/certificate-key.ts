import { randomUUID } from "node:crypto";
import { assertOwnerId, assertSafeStorageKey } from "./image-validation";

export function buildCertificateKey(userId: number): string {
  return assertSafeStorageKey(
    `certificates/${assertOwnerId(userId)}/${randomUUID()}.pdf`,
  );
}
