import { Router } from "express";
import { meController } from "../controllers/me.controller";
import { meEventIdParamsSchema } from "../contracts/me.contract";
import { uploadImage } from "../middlewares/upload";
import { validateParams } from "../middlewares/validate-params";
import { uploadLimiter } from "../middlewares/upload-rate-limit";

export const meRouter = Router();

meRouter.get("/", meController.getProfile);
meRouter.patch("/", meController.updateProfile);

meRouter.post("/avatar", uploadLimiter, uploadImage, meController.uploadAvatar);
meRouter.delete("/avatar", meController.deleteAvatar);

meRouter.get("/stats", meController.getStats);
meRouter.get("/registrations", meController.listMyRegistrations);
meRouter.delete(
  "/registrations/:registrationId",
  meController.cancelRegistration,
);
meRouter.get("/agenda", meController.agenda);

meRouter.get("/events", meController.listMyEvents);
meRouter.post("/events", meController.createEvent);
meRouter.get(
  "/events/:eventId/registrations",
  meController.listOrganizerRegistrations,
);
meRouter.patch(
  "/events/:eventId/registrations/:registrationId",
  meController.patchOrganizerRegistration,
);
meRouter.post("/events/:eventId/publish", meController.publishEvent);

meRouter.post(
  "/events/:eventId/cover",
  uploadLimiter,
  validateParams(meEventIdParamsSchema),
  uploadImage,
  meController.uploadEventCover,
);
meRouter.delete("/events/:eventId/cover", meController.deleteEventCover);

meRouter.get("/events/:eventId", meController.getOrganizerEvent);
meRouter.patch("/events/:eventId", meController.patchOrganizerEvent);
meRouter.delete("/events/:eventId", meController.deleteOrganizerEvent);
