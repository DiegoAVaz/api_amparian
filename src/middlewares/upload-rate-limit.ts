import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { getEnv } from "../config/env";

const UPLOADS_PER_WINDOW = 20;

export const uploadLimiter = rateLimit({
  windowMs: getEnv().AUTH_RATE_LIMIT_WINDOW_MS,
  limit: UPLOADS_PER_WINDOW,
  keyGenerator: (req) =>
    req.userId ? `u:${req.userId}` : ipKeyGenerator(req.ip ?? ""),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Muitos envios de imagem. Tente novamente em instantes.",
      details: null,
    },
  },
});
