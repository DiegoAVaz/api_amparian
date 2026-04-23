import type { Request, Response } from "express";
import {
  eventRegistrationBodySchema,
  publicEventIdParamsSchema,
  publicEventsListQuerySchema,
} from "../contracts/events.contract";
import { getContainer } from "../di/container";
import { wrapAsync } from "../middlewares/wrap";

export const eventsPublicController = {
  list: wrapAsync(async (req: Request, res: Response) => {
    const q = publicEventsListQuerySchema.parse(req.query);
    const result = await getContainer().listPublicEvents.execute({ q: q.q, page: q.page, limit: q.limit });
    res.json(result);
  }),

  getById: wrapAsync(async (req: Request, res: Response) => {
    const { eventId } = publicEventIdParamsSchema.parse(req.params);
    const result = await getContainer().getPublicEvent.execute(eventId);
    res.json(result);
  }),

  register: wrapAsync(async (req: Request, res: Response) => {
    const { eventId } = publicEventIdParamsSchema.parse(req.params);
    const body = eventRegistrationBodySchema.parse(req.body);
    const userId = req.userId!;
    const result = await getContainer().registerForEvent.execute(eventId, userId, {
      participantRole: body.participantRole,
      agreedResponsibility: body.agreedResponsibility,
    });
    res.status(201).json(result);
  }),
};
