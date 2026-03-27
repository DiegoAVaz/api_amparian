import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { errorHandler } from "./middlewares/error-handler";
import { apiV1Router } from "./routes";

export function createApp() {
  const app = express();

  const allowedOrigins = (env.CORS_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  app.use(
    cors(
      allowedOrigins.length > 0
        ? {
            origin(origin, callback) {
              // Allow tools and same-origin requests that do not send Origin.
              if (!origin) {
                callback(null, true);
                return;
              }

              if (allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
              }

              callback(new Error("Not allowed by CORS"));
            },
          }
        : undefined,
    ),
  );
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/v1", apiV1Router);

  app.use(errorHandler);

  return app;
}
