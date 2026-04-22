import { rateLimit } from "express-rate-limit";
import { env } from "../config/env";

function createAuthLimiter(max: number) {
  return rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: "TOO_MANY_REQUESTS",
        message: "Muitas tentativas. Tente novamente em instantes.",
        details: null,
      },
    },
  });
}

export const authLoginLimiter = createAuthLimiter(env.AUTH_RATE_LIMIT_LOGIN_MAX);
export const authRefreshLimiter = createAuthLimiter(env.AUTH_RATE_LIMIT_REFRESH_MAX);
export const authForgotPasswordLimiter = createAuthLimiter(env.AUTH_RATE_LIMIT_FORGOT_PASSWORD_MAX);
export const authResetPasswordLimiter = createAuthLimiter(env.AUTH_RATE_LIMIT_RESET_PASSWORD_MAX);
