import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { authRouter } from "./auth.routes";
import { eventsPublicRouter } from "./events-public.routes";
import { healthRouter } from "./health.routes";
import { lookupRouter } from "./lookup.routes";
import { meRouter } from "./me.routes";

export const apiV1Router = Router();

apiV1Router.use("/health", healthRouter);
apiV1Router.use("/auth", authRouter);
apiV1Router.use("/lookups", lookupRouter);
apiV1Router.use("/events", eventsPublicRouter);
apiV1Router.use("/me", requireAuth, meRouter);
