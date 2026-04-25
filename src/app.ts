import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { openApiDocument } from "./docs/openapi";
import { errorHandler } from "./middlewares/error-handler";
import { apiV1Router } from "./routes";

function allowSwaggerUi(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (
    req.path === "/"
    || req.path.startsWith("/swagger-ui")
    || req.path.startsWith("/favicon")
  ) {
    res.removeHeader("Content-Security-Policy");
  }
  next();
}

function createApiCorsOptions(allowlistedOrigins: string[]): cors.CorsOptions | undefined {
  if (allowlistedOrigins.length === 0) {
    return undefined;
  }

  return {
    origin(origin, callback) {
      // Allow same-origin navigation, server-to-server calls, and tooling without Origin.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowlistedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, true);
    },
    credentials: true,
  };
}

function guardDisallowedApiOrigin(allowlistedOrigins: string[]): express.RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;

    if (!origin || allowlistedOrigins.length === 0 || allowlistedOrigins.includes(origin)) {
      next();
      return;
    }

    res.status(403).json({
      error: {
        code: "CORS_NOT_ALLOWED",
        message: "Origem nao permitida",
        details: null,
      },
    });
  };
}

export function createApp() {
  const app = express();
  const isProduction = env.NODE_ENV === "production";

  const allowedOrigins = (env.CORS_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const devDefaultOrigin = "http://localhost:3000";
  const allowlistedOrigins = allowedOrigins.length > 0
    ? allowedOrigins
    : env.NODE_ENV === "production"
      ? []
      : [devDefaultOrigin];
  const apiCorsOptions = createApiCorsOptions(allowlistedOrigins);

  app.disable("x-powered-by");
  app.set("trust proxy", isProduction ? 1 : false);
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));

  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });
  app.use("/", allowSwaggerUi, swaggerUi.serve);
  app.get(
    "/",
    allowSwaggerUi,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "Amparian API Docs",
      explorer: true,
      swaggerOptions: {
        withCredentials: true,
      },
    }),
  );

  if (apiCorsOptions) {
    app.use("/api/v1", guardDisallowedApiOrigin(allowlistedOrigins), cors(apiCorsOptions), apiV1Router);
  } else {
    app.use("/api/v1", apiV1Router);
  }

  app.use(errorHandler);

  return app;
}
