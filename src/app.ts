import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { errorHandler } from "./middlewares/error-handler";
import { apiV1Router } from "./routes";

export function createApp() {
  const app = express();

  const origin = env.CORS_ORIGIN;
  app.use(cors(typeof origin === "string" && origin.length > 0 ? { origin } : undefined));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/v1", apiV1Router);

  app.use(errorHandler);

  return app;
}
