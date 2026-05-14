import type { Request, Response } from "express";
import {
  forgotPasswordBodySchema,
  loginBodySchema,
  logoutBodySchema,
  refreshBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
} from "../contracts/auth.contract";
import { getContainer } from "../di/container";
import { wrapAsync } from "../middlewares/wrap";
import { HttpError } from "../utils/http-error";
import {
  clearAuthCookies,
  readCookie,
  REFRESH_COOKIE_NAME,
  setAuthCookies,
} from "../utils/auth-cookies";

export const authController = {
  register: wrapAsync(async (req: Request, res: Response) => {
    const body = registerBodySchema.parse(req.body);
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
    const body = loginBodySchema.parse(req.body);
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
    const body = refreshBodySchema.parse(req.body ?? {});
    const refreshToken =
      body.refreshToken ?? readCookie(req, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      clearAuthCookies(res);
      throw new HttpError(400, "INVALID_REFRESH", "Refresh inválido");
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
    const body = logoutBodySchema.parse(req.body ?? {});
    const refreshToken =
      body.refreshToken ?? readCookie(req, REFRESH_COOKIE_NAME);
    await getContainer().logoutUser.execute(refreshToken);
    clearAuthCookies(res);
    res.status(204).send();
  }),

  forgotPassword: wrapAsync(async (req: Request, res: Response) => {
    const body = forgotPasswordBodySchema.parse(req.body);
    await getContainer().forgotPassword.execute(body.email);
    res
      .status(202)
      .json({ message: "Se o e-mail existir, enviaremos instruções." });
  }),

  resetPassword: wrapAsync(async (req: Request, res: Response) => {
    const body = resetPasswordBodySchema.parse(req.body);
    await getContainer().resetPassword.execute(body.token, body.newPassword);
    res.status(204).send();
  }),
};
