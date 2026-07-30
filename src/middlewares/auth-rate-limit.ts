import { rateLimit } from "express-rate-limit";
import { getEnv } from "../config/env";

function createAuthLimiter(max: number) {
  return rateLimit({
    windowMs: getEnv().AUTH_RATE_LIMIT_WINDOW_MS,
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

export const authLoginLimiter = createAuthLimiter(
  getEnv().AUTH_RATE_LIMIT_LOGIN_MAX,
);
export const authRegisterLimiter = createAuthLimiter(
  getEnv().AUTH_RATE_LIMIT_REGISTER_MAX,
);
export const authRefreshLimiter = createAuthLimiter(
  getEnv().AUTH_RATE_LIMIT_REFRESH_MAX,
);
export const authForgotPasswordLimiter = createAuthLimiter(
  getEnv().AUTH_RATE_LIMIT_FORGOT_PASSWORD_MAX,
);
export const authResetPasswordLimiter = createAuthLimiter(
  getEnv().AUTH_RATE_LIMIT_RESET_PASSWORD_MAX,
);

