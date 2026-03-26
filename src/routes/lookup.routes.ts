import { Router } from "express";
import { lookupController } from "../controllers/lookup.controller";

export const lookupRouter = Router();

lookupRouter.get("/", lookupController.list);
