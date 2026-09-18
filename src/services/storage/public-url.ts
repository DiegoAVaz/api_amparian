import type { Storage } from "./storage";

export type PublicUrlResolver = (value: string | null) => string | null;

function isLegacyAbsoluteUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

export function storageKeyOf(value: string | null): string | null {
  if (!value) return null;
  if (isLegacyAbsoluteUrl(value)) return null;
  return value;
}

export function createPublicUrlResolver(storage: Storage): PublicUrlResolver {
  return (value) => {
    if (!value) return null;
    if (isLegacyAbsoluteUrl(value)) return value;

    try {
      return storage.publicUrl(value);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const detail = value.slice(0, 80);
      if (code === "INVALID_STORAGE_KEY") {
        console.warn(
          `[storage] chave inválida no banco, imagem omitida: ${detail}`,
        );
      } else {
        console.error(
          `[storage] falha ao montar URL pública (imagem omitida): ${detail}`,
          error,
        );
      }
      return null;
    }
  };
}

