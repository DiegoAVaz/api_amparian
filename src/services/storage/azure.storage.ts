import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { assertSafeStorageKey, type ValidatedImage } from "./image-validation";
import type { Storage, StoredObject } from "./storage";

const BLOB_CACHE_CONTROL = "public, max-age=31536000, immutable";

export type AzureBlobStorageConfig = {
  connectionString: string;
  container: string;
  publicBaseUrl?: string;
};

export class AzureBlobStorage implements Storage {
  private readonly config: AzureBlobStorageConfig;
  private container: ContainerClient | null = null;

  constructor(config: AzureBlobStorageConfig) {
    this.config = config;
  }

  private getContainerClient(): ContainerClient {
    if (!this.container) {
      this.container = BlobServiceClient.fromConnectionString(
        this.config.connectionString,
      ).getContainerClient(this.config.container);
    }
    return this.container;
  }

  async put(key: string, image: ValidatedImage): Promise<StoredObject> {
    await this.getContainerClient()
      .getBlockBlobClient(assertSafeStorageKey(key))
      .uploadData(image.buffer, {
        blobHTTPHeaders: {
          blobContentType: image.contentType,
          blobCacheControl: BLOB_CACHE_CONTROL,
        },
        conditions: { ifNoneMatch: "*" },
      });

    return {
      key,
      contentType: image.contentType,
      size: image.buffer.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    await this.getContainerClient()
      .getBlockBlobClient(assertSafeStorageKey(key))
      .deleteIfExists();
  }

  private containerBaseUrl(): string {
    const url = new URL(this.getContainerClient().url);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  publicUrl(key: string): string {
    const base = (this.config.publicBaseUrl ?? this.containerBaseUrl()).replace(
      /\/+$/,
      "",
    );
    const path = assertSafeStorageKey(key)
      .split("/")
      .map(encodeURIComponent)
      .join("/");

    return `${base}/${path}`;
  }
}

