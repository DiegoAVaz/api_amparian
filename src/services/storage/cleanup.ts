import { storageKeyOf } from "./public-url";
import type { Storage } from "./storage";

export async function deleteBlobIfOurs(
  storage: Storage,
  value: string | null,
): Promise<void> {
  const key = storageKeyOf(value);
  if (!key) return;

  try {
    await storage.delete(key);
  } catch (error) {
    console.error(
      `[storage] não foi possível apagar o blob ${key}, segue órfão:`,
      error,
    );
  }
}
