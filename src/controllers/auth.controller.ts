import type { Request, Response } from "express";
import { z } from "zod";
import { getContainer } from "../di/container";
import { wrapAsync } from "../middlewares/wrap";
import { HttpError } from "../utils/http-error";
import {
  clearAuthCookies,
  readCookie,
  REFRESH_COOKIE_NAME,
  setAuthCookies,
} from "../utils/auth-cookies";

const strongPassword = z
  .string()
  .min(8, "A senha deve ter pelo menos 8 caracteres")
  .max(72, "A senha deve ter no máximo 72 caracteres")
  .regex(/[A-Z]/, "A senha deve ter ao menos 1 letra maiúscula")
  .regex(/[a-z]/, "A senha deve ter ao menos 1 letra minúscula")
  .regex(/\d/, "A senha deve ter ao menos 1 número")
  .regex(/[^\w\s]/, "A senha deve ter ao menos 1 caractere especial");

const registerBody = z.object({
  email: z.string().email(),
  password: strongPassword,
  name: z.string().min(1),
  phone: z.string().optional(),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshBody = z.object({
  refreshToken: z.string().min(1).optional(),
});

const logoutBody = z.object({
  refreshToken: z.string().optional(),
});

export const authController = {
  register: wrapAsync(async (req: Request, res: Response) => {
    const body = registerBody.parse(req.body);
    const result = await getContainer().registerUser.execute(body);
    setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    res.status(201).json({
      user: result.user,
      expiresIn: result.expiresIn,
    });
  }),

  login: wrapAsync(async (req: Request, res: Response) => {
    const body = loginBody.parse(req.body);
    const result = await getContainer().loginUser.execute(body);
    setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    res.json({
      user: result.user,
      expiresIn: result.expiresIn,
    });
  }),

  refresh: wrapAsync(async (req: Request, res: Response) => {
    const body = refreshBody.parse(req.body ?? {});
    const refreshToken = body.refreshToken ?? readCookie(req, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      clearAuthCookies(res);
      throw new HttpError(401, "INVALID_REFRESH", "Refresh inválido");
    }

    try {
      const result = await getContainer().refreshSession.execute(refreshToken, {
        userAgent: req.headers["user-agent"],
        ip: req.ip,
      });
      setAuthCookies(res, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      res.status(204).send();
    } catch (error) {
      clearAuthCookies(res);
      throw error;
    }
  }),

  logout: wrapAsync(async (req: Request, res: Response) => {
    const body = logoutBody.parse(req.body);
    const refreshToken = body.refreshToken ?? readCookie(req, REFRESH_COOKIE_NAME);
    await getContainer().logoutUser.execute(refreshToken);
    clearAuthCookies(res);
    res.status(204).send();
  }),

  forgotPassword: wrapAsync(async (req: Request, res: Response) => {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    await getContainer().forgotPassword.execute(body.email);
    res.status(202).json({ message: "Se o e-mail existir, enviaremos instruções." });
  }),

  resetPassword: wrapAsync(async (req: Request, res: Response) => {
    const body = z
      .object({
        token: z.string().min(1),
        newPassword: strongPassword,
      })
      .parse(req.body);
    await getContainer().resetPassword.execute(body.token, body.newPassword);
    res.status(204).send();
  }),
};
