import type { Request, Response } from "express";
import { getContainer } from "../di/container";
import { wrapAsync } from "../middlewares/wrap";

export const lookupController = {
  list: wrapAsync(async (_req: Request, res: Response) => {
    const result = await getContainer().listLookups.execute();
    res.json(result);
  }),
};
