import { rateLimit } from "express-rate-limit";
import { getEnv } from "../config/env";

// Limite próprio da verificação pública (RC-08). A rota não pede login, então o limite é por IP.
// Com 32¹² códigos possíveis, nem sem limite adivinhar um código válido seria viável; o limite
// impede que a rota vire uma varredura barata do banco.
export const certificateVerifyLimiter = rateLimit({
  windowMs: getEnv().AUTH_RATE_LIMIT_WINDOW_MS,
  limit: getEnv().CERTIFICATE_VERIFY_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Muitas consultas de certificado. Tente novamente em instantes.",
      details: null,
    },
  },
});
