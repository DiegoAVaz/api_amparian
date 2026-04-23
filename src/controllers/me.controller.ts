import type { Request, Response } from "express";
import {
  createEventBodySchema,
  meAgendaQuerySchema,
  meEventIdParamsSchema,
  meEventRegistrationParamsSchema,
  meEventsFilterQuerySchema,
  meProfilePatchBodySchema,
  meRegistrationIdParamsSchema,
  meRegistrationsQuerySchema,
  patchEventBodySchema,
  updateOrganizerRegistrationBodySchema,
} from "../contracts/me.contract";
import { getContainer } from "../di/container";
import { wrapAsync } from "../middlewares/wrap";

export const meController = {
  getProfile: wrapAsync(async (req: Request, res: Response) => {
    const user = await getContainer().getProfile.execute(req.userId!);
    res.json(user);
  }),

  updateProfile: wrapAsync(async (req: Request, res: Response) => {
    const body = meProfilePatchBodySchema.parse(req.body);
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
    const q = meRegistrationsQuerySchema.parse(req.query);
    const result = await getContainer().listMyRegistrations.execute(req.userId!, q.page, q.limit);
    res.json(result);
  }),

  cancelRegistration: wrapAsync(async (req: Request, res: Response) => {
    const { registrationId } = meRegistrationIdParamsSchema.parse(req.params);
    await getContainer().cancelRegistration.execute(req.userId!, registrationId);
    res.status(204).send();
  }),

  agenda: wrapAsync(async (req: Request, res: Response) => {
    const q = meAgendaQuerySchema.parse(req.query);
    const result = await getContainer().getMyAgenda.execute(req.userId!, q.year, q.month);
    res.json(result);
  }),

  listMyEvents: wrapAsync(async (req: Request, res: Response) => {
    const q = meEventsFilterQuerySchema.parse(req.query);
    const result = await getContainer().listMyEvents.execute(req.userId!, q.filter);
    res.json(result);
  }),

  createEvent: wrapAsync(async (req: Request, res: Response) => {
    const body = createEventBodySchema.parse(req.body);
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
    const { eventId } = meEventIdParamsSchema.parse(req.params);
    const result = await getContainer().listOrganizerRegistrations.execute(req.userId!, eventId);
    res.json(result);
  }),

  patchOrganizerRegistration: wrapAsync(async (req: Request, res: Response) => {
    const { eventId, registrationId } = meEventRegistrationParamsSchema.parse(req.params);
    const body = updateOrganizerRegistrationBodySchema.parse(req.body);
    const result = await getContainer().updateRegistrationStatus.execute(
      req.userId!,
      eventId,
      registrationId,
      body.status,
    );
    res.json(result);
  }),

  publishEvent: wrapAsync(async (req: Request, res: Response) => {
    const { eventId } = meEventIdParamsSchema.parse(req.params);
    const result = await getContainer().publishEvent.execute(req.userId!, eventId);
    res.json(result);
  }),

  getOrganizerEvent: wrapAsync(async (req: Request, res: Response) => {
    const { eventId } = meEventIdParamsSchema.parse(req.params);
    const result = await getContainer().getOrganizerEvent.execute(req.userId!, eventId);
    res.json(result);
  }),

  patchOrganizerEvent: wrapAsync(async (req: Request, res: Response) => {
    const { eventId } = meEventIdParamsSchema.parse(req.params);
    const body = patchEventBodySchema.parse(req.body);
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
    const { eventId } = meEventIdParamsSchema.parse(req.params);
    await getContainer().deleteEvent.execute(req.userId!, eventId);
    res.status(204).send();
  }),
};
