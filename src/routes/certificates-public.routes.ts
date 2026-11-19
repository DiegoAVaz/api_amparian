import { Router } from "express";
import { certificatesPublicController } from "../controllers/certificates-public.controller";
import { certificateVerifyLimiter } from "../middlewares/certificate-verify-rate-limit";

// Rotas públicas de certificado: sem `requireAuth`, porque quem confere o documento não tem conta
// (RC-08).
export const certificatesPublicRouter = Router();

certificatesPublicRouter.get(
  "/verify/:code",
  certificateVerifyLimiter,
  certificatesPublicController.verify,
);
