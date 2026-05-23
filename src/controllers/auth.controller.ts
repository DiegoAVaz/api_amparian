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
import { parseBody } from "../utils/request-validation";

export const authController = {
  register: wrapAsync(async (req: Request, res: Response) => {
    const body = parseBody(registerBodySchema, req.body);
    const result = await getContainer().registerUser.execute(body);
    res.status(201).json(result);
  }),

  login: wrapAsync(async (req: Request, res: Response) => {
    const body = parseBody(loginBodySchema, req.body);
    const result = await getContainer().loginUser.execute(body);
    res.json(result);
  }),

  refresh: wrapAsync(async (req: Request, res: Response) => {
    const body = parseBody(refreshBodySchema, req.body);
    const result = await getContainer().refreshSession.execute(body.refreshToken, {
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });
    res.json(result);
  }),

  logout: wrapAsync(async (req: Request, res: Response) => {
    const body = parseBody(logoutBodySchema, req.body ?? {});
    await getContainer().logoutUser.execute(body.refreshToken);
    res.status(204).send();
  }),

  forgotPassword: wrapAsync(async (req: Request, res: Response) => {
    const body = parseBody(forgotPasswordBodySchema, req.body);
    await getContainer().forgotPassword.execute(body.email);
    res
      .status(202)
      .json({ message: "Se o e-mail existir, enviaremos instruções." });
  }),

  resetPassword: wrapAsync(async (req: Request, res: Response) => {
    const body = parseBody(resetPasswordBodySchema, req.body);
    await getContainer().resetPassword.execute(body.token, body.newPassword);
    res.status(204).send();
  }),
};
