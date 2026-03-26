import { Router } from "express";
import { meController } from "../controllers/me.controller";

export const meRouter = Router();

meRouter.get("/", meController.getProfile);
meRouter.patch("/", meController.updateProfile);
meRouter.get("/stats", meController.getStats);
meRouter.get("/registrations", meController.listMyRegistrations);
meRouter.delete("/registrations/:registrationId", meController.cancelRegistration);
meRouter.get("/agenda", meController.agenda);

meRouter.get("/events", meController.listMyEvents);
meRouter.post("/events", meController.createEvent);
meRouter.get("/events/:eventId/registrations", meController.listOrganizerRegistrations);
meRouter.patch("/events/:eventId/registrations/:registrationId", meController.patchOrganizerRegistration);
meRouter.post("/events/:eventId/publish", meController.publishEvent);
meRouter.get("/events/:eventId", meController.getOrganizerEvent);
meRouter.patch("/events/:eventId", meController.patchOrganizerEvent);
meRouter.delete("/events/:eventId", meController.deleteOrganizerEvent);
