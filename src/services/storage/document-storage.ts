import type { StoredObject } from "./storage";


export type PdfDocument = {
  readonly buffer: Buffer;
  readonly contentType: "application/pdf";
};

export interface DocumentStorage {
  put(key: string, document: PdfDocument): Promise<StoredObject>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}
