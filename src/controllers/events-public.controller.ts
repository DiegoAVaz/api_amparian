import type { Request, Response } from "express";
import { z } from "zod";
import { getContainer } from "../di/container";
import { wrapAsync } from "../middlewares/wrap";

const listQuery = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const registerBody = z.object({
  participantRole: z.string().optional(),
  agreedResponsibility: z.boolean(),
});

export const eventsPublicController = {
  list: wrapAsync(async (req: Request, res: Response) => {
    const q = listQuery.parse(req.query);
    const result = await getContainer().listPublicEvents.execute({ q: q.q, page: q.page, limit: q.limit });
    res.json(result);
  }),

  getById: wrapAsync(async (req: Request, res: Response) => {
    const eventId = z.coerce.number().int().positive().parse(req.params.eventId);
    const result = await getContainer().getPublicEvent.execute(eventId);
    res.json(result);
  }),

  register: wrapAsync(async (req: Request, res: Response) => {
    const eventId = z.coerce.number().int().positive().parse(req.params.eventId);
    const body = registerBody.parse(req.body);
    const userId = req.userId!;
    const result = await getContainer().registerForEvent.execute(eventId, userId, {
      participantRole: body.participantRole,
      agreedResponsibility: body.agreedResponsibility,
    });
    res.status(201).json(result);
  }),
};
