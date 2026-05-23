import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { openApiDocument } from "./docs/openapi";
import { errorHandler } from "./middlewares/error-handler";
import { apiV1Router } from "./routes";
import { swaggerHtml } from "./docs/swaggerHtml";

function allowSwaggerUi(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (req.path === "/docs") {
    res.removeHeader("Content-Security-Policy");
  }
  next();
}

function getRequestOrigin(req: express.Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function isSameOriginRequest(req: express.Request, origin: string): boolean {
  try {
    const originUrl = new URL(origin);
    const requestHost = req.get("host");

    if (!requestHost) {
      return false;
    }

    if (originUrl.host !== requestHost) {
      return false;
    }

    return (
      origin === getRequestOrigin(req) ||
      req.protocol === "http" ||
      req.protocol === "https"
    );
  } catch {
    return false;
  }
}

function isAllowedApiOrigin(
  req: express.Request,
  allowlistedOrigins: string[],
  origin?: string,
): boolean {
  if (!origin) {
    return true;
  }

  if (isSameOriginRequest(req, origin)) {
    return true;
  }

  return allowlistedOrigins.includes(origin);
}

function createApiCorsOptions(
  allowlistedOrigins: string[],
): cors.CorsOptionsDelegate<express.Request> {
  return (req, callback) => {
    callback(null, {
      origin: isAllowedApiOrigin(req, allowlistedOrigins, req.headers.origin),
    });
  };
}

function guardDisallowedApiOrigin(
  allowlistedOrigins: string[],
): express.RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;

    if (isAllowedApiOrigin(req, allowlistedOrigins, origin)) {
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
  const allowlistedOrigins =
    allowedOrigins.length > 0
      ? allowedOrigins
      : env.NODE_ENV === "production"
        ? []
        : [devDefaultOrigin];
  const apiCorsOptions = createApiCorsOptions(allowlistedOrigins);

  app.disable("x-powered-by");
  app.set("trust proxy", isProduction ? 1 : false);
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));

  const exposePublicDocs = !isProduction;

  if (exposePublicDocs) {
    app.get("/openapi.json", (_req, res) => {
      res.json(openApiDocument);
    });

    app.get("/docs", allowSwaggerUi, (_req, res) => {
      res.type("html").send(swaggerHtml());
    });
  }

  app.use(
    "/api/v1",
    guardDisallowedApiOrigin(allowlistedOrigins),
    cors(apiCorsOptions),
    apiV1Router,
  );

  app.use(errorHandler);

  return app;
}
