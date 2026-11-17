import { getEnv } from "../../config/env";
import { AzureDocumentStorage } from "./azure-document.storage";
import { AzureBlobStorage } from "./azure.storage";
import type { DocumentStorage } from "./document-storage";
import type { Storage } from "./storage";

export type { Storage, StoredObject } from "./storage";
export { AzureBlobStorage } from "./azure.storage";
export type { AzureBlobStorageConfig } from "./azure.storage";
export type { DocumentStorage, PdfDocument } from "./document-storage";
export { AzureDocumentStorage } from "./azure-document.storage";
export type {
  AzureDocumentStorageConfig,
  DocumentContainerClient,
} from "./azure-document.storage";
export { buildCertificateKey } from "./certificate-key";
export { createPublicUrlResolver, storageKeyOf } from "./public-url";
export { deleteBlobIfOurs } from "./cleanup";
export {
  buildAvatarKey,
  buildEventCoverKey,
  validateImage,
} from "./image-validation";
export type { DetectedImage, ValidatedImage } from "./image-validation";
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

let cachedCertificates: DocumentStorage | null = null;

export function createCertificateStorage(): DocumentStorage {
  if (!cachedCertificates) {
    const env = getEnv();
    cachedCertificates = new AzureDocumentStorage({
      connectionString: env.AZURE_STORAGE_CONNECTION_STRING,
      container: env.AZURE_STORAGE_CERTIFICATES_CONTAINER,
    });
  }
  return cachedCertificates;
}
