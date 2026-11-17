import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { internalServerError } from "../../utils/http-error";
import type { DocumentStorage, PdfDocument } from "./document-storage";
import { assertSafeStorageKey } from "./image-validation";
import type { StoredObject } from "./storage";

const DOCUMENT_CACHE_CONTROL = "private, no-store";

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

export type DocumentContainerClient = Pick<
  ContainerClient,
  "getBlockBlobClient" | "getProperties"
>;

function azureErrorCode(error: unknown): string | undefined {
  const { statusCode, code, details } = error as {
    statusCode?: unknown;
    code?: unknown;
    details?: { errorCode?: unknown };
  };
  if (statusCode !== 404) return undefined;
  const found = typeof code === "string" ? code : details?.errorCode;
  return typeof found === "string" ? found : undefined;
}

export type AzureDocumentStorageConfig = {
  connectionString: string;
  container: string;
};

export class AzureDocumentStorage implements DocumentStorage {
  private readonly config: AzureDocumentStorageConfig;
  private client: DocumentContainerClient | null;
  private privacyCheck: Promise<void> | null = null;

  constructor(
    config: AzureDocumentStorageConfig,
    client?: DocumentContainerClient,
  ) {
    this.config = config;
    this.client = client ?? null;
  }

  private getContainerClient(): DocumentContainerClient {
    if (!this.client) {
      this.client = BlobServiceClient.fromConnectionString(
        this.config.connectionString,
      ).getContainerClient(this.config.container);
    }
    return this.client;
  }

  private ensurePrivate(): Promise<void> {
    if (!this.privacyCheck) {
      this.privacyCheck = this.getContainerClient()
        .getProperties()
        .then((properties) => {
          if (properties.blobPublicAccess) {
            console.error(
              `[storage] o container de documentos "${this.config.container}" aceita leitura anônima (${properties.blobPublicAccess}); nenhum certificado será gravado ou lido até ele ser Private`,
            );
            throw internalServerError(
              "DOCUMENT_STORAGE_NOT_PRIVATE",
              "O armazenamento de certificados está mal configurado",
            );
          }
        })
        .catch((error: unknown) => {
          if (
            (error as { code?: unknown } | null)?.code !==
            "DOCUMENT_STORAGE_NOT_PRIVATE"
          ) {
            this.privacyCheck = null;
          }
          throw error;
        });
    }
    return this.privacyCheck;
  }

  async put(key: string, document: PdfDocument): Promise<StoredObject> {
    const safeKey = assertSafeStorageKey(key);
    if (
      document.buffer.byteLength < PDF_MAGIC.byteLength ||
      !document.buffer.subarray(0, PDF_MAGIC.byteLength).equals(PDF_MAGIC)
    ) {
      throw internalServerError(
        "INVALID_DOCUMENT",
        "Não foi possível gerar o arquivo do certificado",
      );
    }

    await this.ensurePrivate();
    await this.getContainerClient()
      .getBlockBlobClient(safeKey)
      .uploadData(document.buffer, {
        blobHTTPHeaders: {
          blobContentType: document.contentType,
          blobCacheControl: DOCUMENT_CACHE_CONTROL,
        },
        conditions: { ifNoneMatch: "*" },
      });

    return {
      key: safeKey,
      contentType: document.contentType,
      size: document.buffer.byteLength,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    const safeKey = assertSafeStorageKey(key);
    await this.ensurePrivate();
    try {
      return await this.getContainerClient()
        .getBlockBlobClient(safeKey)
        .downloadToBuffer();
    } catch (error) {
      // Só "o blob não existe" vira `null`. `ContainerNotFound` também é 404,
      // mas é configuração errada, e regenerar o PDF não resolveria: lança.
      if (azureErrorCode(error) === "BlobNotFound") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const safeKey = assertSafeStorageKey(key);
    await this.ensurePrivate();
    await this.getContainerClient()
      .getBlockBlobClient(safeKey)
      .deleteIfExists();
  }
}
