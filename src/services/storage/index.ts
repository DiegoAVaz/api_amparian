import { getEnv } from "../../config/env";
import { AzureBlobStorage } from "./azure.storage";
import type { Storage } from "./storage";

export type { Storage, StoredObject } from "./storage";
export { AzureBlobStorage } from "./azure.storage";
export type { AzureBlobStorageConfig } from "./azure.storage";
export { createPublicUrlResolver, storageKeyOf } from "./public-url";
export type { PublicUrlResolver } from "./public-url";

let cached: Storage | null = null;

/**
 * Cria uma instância de `Storage` com base nas variáveis de ambiente. Mantém em cache a instância para que seja singleton.
 */
export function createStorage(): Storage {
  if (!cached) {
    const env = getEnv();
    cached = new AzureBlobStorage({
      connectionString: env.AZURE_STORAGE_CONNECTION_STRING,
      container: env.AZURE_STORAGE_CONTAINER,
      publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL,
    });
  }
  return cached;
}

