import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { parseParams } from "../utils/request-validation";

export function validateParams(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      parseParams(schema, req.params);
      next();
    } catch (error) {
      next(error);
    }
  };
}

