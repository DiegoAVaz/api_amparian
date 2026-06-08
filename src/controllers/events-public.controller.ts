import type { Request, Response } from "express";
import {
  eventRegistrationBodySchema,
  publicEventIdParamsSchema,
  publicEventsListQuerySchema,
} from "../contracts/events.contract";
import { getContainer } from "../di/container";
import { wrapAsync } from "../middlewares/wrap";
import { parseBody, parseParams, parseQuery } from "../utils/request-validation";

export const eventsPublicController = {
  list: wrapAsync(async (req: Request, res: Response) => {
    const q = parseQuery(publicEventsListQuerySchema, req.query);
    const result = await getContainer().listPublicEvents.execute({ q: q.q, page: q.page, limit: q.limit });
    res.json(result);
  }),

  getById: wrapAsync(async (req: Request, res: Response) => {
    const { eventId } = parseParams(publicEventIdParamsSchema, req.params);
    const result = await getContainer().getPublicEvent.execute(eventId);
    res.json(result);
  }),

  register: wrapAsync(async (req: Request, res: Response) => {
    const { eventId } = parseParams(publicEventIdParamsSchema, req.params);
    const body = parseBody(eventRegistrationBodySchema, req.body);
    const userId = req.userId!;
    const result = await getContainer().registerForEvent.execute(eventId, userId, {
      participantRole: body.participantRole,
      agreedResponsibility: body.agreedResponsibility,
    });
    res.status(201).json(result);
  }),
};
