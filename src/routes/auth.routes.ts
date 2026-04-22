import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import {
  authForgotPasswordLimiter,
  authLoginLimiter,
  authRefreshLimiter,
  authResetPasswordLimiter,
} from "../middlewares/auth-rate-limit";

export const authRouter = Router();

authRouter.post("/register", authController.register);
authRouter.post("/login", authLoginLimiter, authController.login);
authRouter.post("/refresh", authRefreshLimiter, authController.refresh);
authRouter.post("/logout", authController.logout);
authRouter.post("/forgot-password", authForgotPasswordLimiter, authController.forgotPassword);
authRouter.post("/reset-password", authResetPasswordLimiter, authController.resetPassword);
