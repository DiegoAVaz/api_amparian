import type { ValidatedImage } from "./image-validation";

export type StoredObject = {
  key: string;
  contentType: string;
  size: number;
};

export interface Storage {
  put(key: string, image: ValidatedImage): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

