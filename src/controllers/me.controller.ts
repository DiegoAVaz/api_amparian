import type { Request, Response } from "express";
import { z } from "zod";
import { getContainer } from "../di/container";
import { wrapAsync } from "../middlewares/wrap";

const patchBody = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().length(2).nullable().optional(),
  bio: z.string().nullable().optional(),
  publicOrganizationName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});

const myRegsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const agendaQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const filterQuery = z.object({
  filter: z.enum(["upcoming", "past", "ongoing"]).optional(),
});

const createEventBody = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().nullable().optional(),
  rulesTerms: z.string().nullable().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().optional(),
  locationName: z.string().nullable().optional(),
  isRemote: z.boolean(),
  capacity: z.number().int().positive().nullable().optional(),
  highlightSkill: z.string().nullable().optional(),
  typeCodes: z.array(z.string()).min(1),
  requirementCodes: z.array(z.string()),
  publish: z.boolean(),
  coverImageUrl: z.string().nullable().optional(),
});

const patchEventBody = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  rulesTerms: z.string().nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  locationName: z.string().nullable().optional(),
  isRemote: z.boolean().optional(),
  capacity: z.number().int().positive().nullable().optional(),
  highlightSkill: z.string().nullable().optional(),
  coverImageUrl: z.string().nullable().optional(),
  typeCodes: z.array(z.string()).optional(),
  requirementCodes: z.array(z.string()).optional(),
  publish: z.boolean().optional(),
});

const patchRegBody = z.object({
  status: z.enum(["pending", "confirmed", "cancelled"]),
});

export const meController = {
  getProfile: wrapAsync(async (req: Request, res: Response) => {
    const user = await getContainer().getProfile.execute(req.userId!);
    res.json(user);
  }),

  updateProfile: wrapAsync(async (req: Request, res: Response) => {
    const body = patchBody.parse(req.body);
    const user = await getContainer().updateProfile.execute(req.userId!, {
      name: body.name,
      phone: body.phone,
      city: body.city,
      state: body.state,
      bio: body.bio,
      publicOrganizationName: body.publicOrganizationName,
      avatarUrl: body.avatarUrl,
    });
    res.json(user);
  }),

  getStats: wrapAsync(async (req: Request, res: Response) => {
    const stats = await getContainer().getProfileStats.execute(req.userId!);
    res.json(stats);
  }),

  listMyRegistrations: wrapAsync(async (req: Request, res: Response) => {
    const q = myRegsQuery.parse(req.query);
    const result = await getContainer().listMyRegistrations.execute(req.userId!, q.page, q.limit);
    res.json(result);
  }),

  cancelRegistration: wrapAsync(async (req: Request, res: Response) => {
    const registrationId = z.coerce.number().int().positive().parse(req.params.registrationId);
    await getContainer().cancelRegistration.execute(req.userId!, registrationId);
    res.status(204).send();
  }),

  agenda: wrapAsync(async (req: Request, res: Response) => {
    const q = agendaQuery.parse(req.query);
    const result = await getContainer().getMyAgenda.execute(req.userId!, q.year, q.month);
    res.json(result);
  }),

  listMyEvents: wrapAsync(async (req: Request, res: Response) => {
    const q = filterQuery.parse(req.query);
    const result = await getContainer().listMyEvents.execute(req.userId!, q.filter);
    res.json(result);
  }),

  createEvent: wrapAsync(async (req: Request, res: Response) => {
    const body = createEventBody.parse(req.body);
    const result = await getContainer().createEvent.execute(req.userId!, {
      title: body.title,
      summary: body.summary,
      description: body.description ?? null,
      rulesTerms: body.rulesTerms ?? null,
      startsAt: body.startsAt,
      endsAt: body.endsAt ?? null,
      locationName: body.locationName ?? null,
      isRemote: body.isRemote,
      capacity: body.capacity ?? null,
      highlightSkill: body.highlightSkill ?? null,
      typeCodes: body.typeCodes,
      requirementCodes: body.requirementCodes,
      publish: body.publish,
      coverImageUrl: body.coverImageUrl ?? null,
    });
    res.status(201).json(result);
  }),

  listOrganizerRegistrations: wrapAsync(async (req: Request, res: Response) => {
    const eventId = z.coerce.number().int().positive().parse(req.params.eventId);
    const result = await getContainer().listOrganizerRegistrations.execute(req.userId!, eventId);
    res.json(result);
  }),

  patchOrganizerRegistration: wrapAsync(async (req: Request, res: Response) => {
    const eventId = z.coerce.number().int().positive().parse(req.params.eventId);
    const registrationId = z.coerce.number().int().positive().parse(req.params.registrationId);
    const body = patchRegBody.parse(req.body);
    const result = await getContainer().updateRegistrationStatus.execute(
      req.userId!,
      eventId,
      registrationId,
      body.status,
    );
    res.json(result);
  }),

  publishEvent: wrapAsync(async (req: Request, res: Response) => {
    const eventId = z.coerce.number().int().positive().parse(req.params.eventId);
    const result = await getContainer().publishEvent.execute(req.userId!, eventId);
    res.json(result);
  }),

  getOrganizerEvent: wrapAsync(async (req: Request, res: Response) => {
    const eventId = z.coerce.number().int().positive().parse(req.params.eventId);
    const result = await getContainer().getOrganizerEvent.execute(req.userId!, eventId);
    res.json(result);
  }),

  patchOrganizerEvent: wrapAsync(async (req: Request, res: Response) => {
    const eventId = z.coerce.number().int().positive().parse(req.params.eventId);
    const body = patchEventBody.parse(req.body);
    const result = await getContainer().updateEvent.execute(req.userId!, eventId, {
      title: body.title,
      summary: body.summary,
      description: body.description,
      rulesTerms: body.rulesTerms,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      locationName: body.locationName,
      isRemote: body.isRemote,
      capacity: body.capacity,
      highlightSkill: body.highlightSkill,
      coverImageUrl: body.coverImageUrl,
      typeCodes: body.typeCodes,
      requirementCodes: body.requirementCodes,
      publish: body.publish,
    });
    res.json(result);
  }),

  deleteOrganizerEvent: wrapAsync(async (req: Request, res: Response) => {
    const eventId = z.coerce.number().int().positive().parse(req.params.eventId);
    await getContainer().deleteEvent.execute(req.userId!, eventId);
    res.status(204).send();
  }),
};
