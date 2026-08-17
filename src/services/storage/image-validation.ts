import { randomUUID } from "node:crypto";
import { httpError, internalServerError } from "../../utils/http-error";

export type DetectedImage = {
  contentType: string;
  extension: string;
};

declare const validated: unique symbol;

export type ValidatedImage = Readonly<DetectedImage> & {
  readonly buffer: Buffer;
  readonly [validated]: true;
};

type ImageSignature = DetectedImage & {
  matches: (buffer: Buffer) => boolean;
};

const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF_TAG = Buffer.from("RIFF", "ascii");
const WEBP_TAG = Buffer.from("WEBP", "ascii");

function hasBytesAt(buffer: Buffer, expected: Buffer, offset: number): boolean {
  if (buffer.length < offset + expected.length) return false;
  return buffer.subarray(offset, offset + expected.length).equals(expected);
}

const SIGNATURES: ImageSignature[] = [
  {
    contentType: "image/jpeg",
    extension: "jpg",
    matches: (buffer) => hasBytesAt(buffer, JPEG_SOI, 0),
  },
  {
    contentType: "image/png",
    extension: "png",
    matches: (buffer) => hasBytesAt(buffer, PNG_MAGIC, 0),
  },
  {
    contentType: "image/webp",
    extension: "webp",
    matches: (buffer) =>
      hasBytesAt(buffer, RIFF_TAG, 0) && hasBytesAt(buffer, WEBP_TAG, 8),
  },
];

export function detectImage(buffer: Buffer): DetectedImage | null {
  const signature = SIGNATURES.find((candidate) => candidate.matches(buffer));
  if (!signature) return null;
  return {
    contentType: signature.contentType,
    extension: signature.extension,
  };
}

export function formatSizeLimit(maxBytes: number): string {
  if (maxBytes < 1_000) return `${maxBytes} bytes`;
  if (maxBytes < 1_000_000) return `${Math.floor(maxBytes / 1_000)} KB`;
  return `${(maxBytes / 1_000_000).toFixed(1).replace(".", ",")} MB`;
}

export function validateImage(
  buffer: Buffer,
  maxBytes: number,
): ValidatedImage {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw httpError(400, "EMPTY_FILE", "O arquivo enviado está vazio");
  }

  if (buffer.length > maxBytes) {
    throw httpError(
      413,
      "FILE_TOO_LARGE",
      `A imagem deve ter no máximo ${formatSizeLimit(maxBytes)}`,
    );
  }

  const detected = detectImage(buffer);
  if (!detected) {
    throw httpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Formato não aceito. Envie uma imagem JPEG, PNG ou WebP",
    );
  }

  const image: DetectedImage & { buffer: Buffer } = { ...detected, buffer };
  return image as ValidatedImage;
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSafeStorageKey(key: string): string {
  const segments = key.split("/");
  const safe =
    key.length <= 255 &&
    segments.length > 1 &&
    segments.every((segment) => SAFE_SEGMENT.test(segment));

  if (!safe) {
    throw internalServerError(
      "INVALID_STORAGE_KEY",
      "Não foi possível montar o caminho do arquivo",
    );
  }

  return key;
}

function assertOwnerId(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw internalServerError(
      "INVALID_STORAGE_KEY",
      "Não foi possível montar o caminho do arquivo",
    );
  }
  return id;
}

export function buildAvatarKey(userId: number, image: DetectedImage): string {
  return assertSafeStorageKey(
    `users/${assertOwnerId(userId)}/avatar-${randomUUID()}.${image.extension}`,
  );
}

export function buildEventCoverKey(
  eventId: number,
  image: DetectedImage,
): string {
  return assertSafeStorageKey(
    `events/${assertOwnerId(eventId)}/cover-${randomUUID()}.${image.extension}`,
  );
}

