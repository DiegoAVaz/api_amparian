import { z } from "../docs/zod-openapi";

const phoneWithoutCountryCodeMessage =
  "Informe apenas DDD e número, sem +55. Exemplo: (11) 99999-9999.";

function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function hasBrazilCountryCode(value: string, digits: string): boolean {
  return (
    value.trim().startsWith("+55") ||
    (digits.startsWith("55") && digits.length > 11)
  );
}

function phoneDigitsSchema<TEmpty extends null | undefined>(
  emptyValue: TEmpty,
) {
  return z
    .string()
    .trim()
    .transform((value, ctx): string | TEmpty => {
      if (value.length === 0) {
        return emptyValue;
      }

      const digits = normalizePhoneDigits(value);

      if (hasBrazilCountryCode(value, digits)) {
        ctx.addIssue({
          code: "custom",
          message: phoneWithoutCountryCodeMessage,
        });
        return z.NEVER;
      }

      if (digits.length !== 10 && digits.length !== 11) {
        ctx.addIssue({
          code: "custom",
          message: phoneWithoutCountryCodeMessage,
        });
        return z.NEVER;
      }

      return digits;
    });
}

export const optionalRegisterPhoneSchema =
  phoneDigitsSchema(undefined).optional();

export const nullableProfilePhoneSchema = z
  .preprocess((value) => (value === null ? "" : value), phoneDigitsSchema(null))
  .optional();

