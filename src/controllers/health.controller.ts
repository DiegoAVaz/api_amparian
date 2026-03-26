import type { Request, Response } from "express";
import { wrapAsync } from "../middlewares/wrap";

export const healthController = {
  get: wrapAsync(async (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  }),
};
