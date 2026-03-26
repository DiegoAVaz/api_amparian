import { Router } from "express";
import { eventsPublicController } from "../controllers/events-public.controller";
import { requireAuth } from "../middlewares/auth";

export const eventsPublicRouter = Router();

eventsPublicRouter.get("/", eventsPublicController.list);
eventsPublicRouter.get("/:eventId", eventsPublicController.getById);
eventsPublicRouter.post("/:eventId/registrations", requireAuth, eventsPublicController.register);
