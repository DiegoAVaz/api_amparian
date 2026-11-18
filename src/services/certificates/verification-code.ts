import { randomInt } from "node:crypto";

// Código de verificação do certificado. 32 símbolos: A–Z sem I e O, e 2–9 — sem 0, 1, I e
// O, que se confundem quando alguém digita o código lido de um papel.
export const VERIFICATION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const VERIFICATION_CODE_LENGTH = 12;

/** O formato gravado no banco: 12 símbolos do alfabeto, maiúsculos, sem hífens. */
export const VERIFICATION_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;

/**
 * Sorteia um código novo, já normalizado. `crypto.randomInt`, e nunca `Math.random`: com 32¹²
 * (60 bits) combinações, adivinhar um código só é inviável se o sorteio não for previsível.
 */
export function generateVerificationCode(): string {
  let code = "";
  for (let i = 0; i < VERIFICATION_CODE_LENGTH; i++) {
    code += VERIFICATION_ALPHABET[randomInt(VERIFICATION_ALPHABET.length)];
  }
  return code;
}

/**
 * O que alguém digitou ("r4wt-8hzn-2qkc", com espaços, sem hífens) no formato gravado, ou `null`
 * se não pode ser um código. A busca não depende da collation do banco para ignorar maiúsculas:
 * quem normaliza é a aplicação (RC-07).
 */
export function normalizeVerificationCode(input: string): string | null {
  const normalized = input.replace(/[\s-]/g, "").toUpperCase();
  return VERIFICATION_CODE_PATTERN.test(normalized) ? normalized : null;
}
