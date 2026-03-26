import { computeEventStatus } from "../../utils/event-helpers";
import { HttpError } from "../../utils/http-error";
import { organizerDisplayName } from "../../utils/organizer-name";
import type { EventRepository } from "../../repositories/event.repository";
import type { RegistrationRepository } from "../../repositories/registration.repository";

export class ListPublicEventsUseCase {
  constructor(private readonly events: EventRepository) {}

  async execute(params: { q?: string; page: number; limit: number }) {
    const { rows, total } = await this.events.findPublishedListRow(params);

    const data = rows.map((r) => ({
      id: Number(r.id),
      title: r.title as string,
      summary: r.summary as string,
      org: organizerDisplayName({
        public_organization_name: r.public_organization_name as string | null,
        name: r.organizer_name as string,
      }),
      startsAt: new Date(r.starts_at as string).toISOString(),
      locationName: r.location_name as string | null,
      isRemote: Boolean(r.is_remote),
      capacity: r.capacity === null ? null : Number(r.capacity),
      coverImageUrl: r.cover_image_url as string | null,
      imageKey: null,
    }));

    return { data, meta: { page: params.page, limit: params.limit, total } };
  }
}

export class GetPublicEventUseCase {
  constructor(private readonly events: EventRepository) {}

  async execute(eventId: number) {
    const row = await this.events.findPublishedByIdWithOrganizer(eventId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Evento não encontrado");

    const types = await this.events.findTypesForEvent(eventId);
    const requirements = await this.events.findRequirementsForEvent(eventId);
    const computed = computeEventStatus({
      status: row.status as string,
      starts_at: row.starts_at as string,
      ends_at: (row.ends_at as string | null) ?? null,
    });

    return {
      id: Number(row.id),
      title: row.title as string,
      summary: row.summary as string,
      description: (row.description as string | null) ?? null,
      rulesTerms: (row.rules_terms as string | null) ?? null,
      org: organizerDisplayName({
        public_organization_name: row.public_organization_name as string | null,
        name: row.organizer_name as string,
      }),
      organizerId: Number(row.organizer_id),
      startsAt: new Date(row.starts_at as string).toISOString(),
      endsAt: row.ends_at ? new Date(row.ends_at as string).toISOString() : null,
      locationName: (row.location_name as string | null) ?? null,
      isRemote: Boolean(row.is_remote),
      capacity: row.capacity === null ? null : Number(row.capacity),
      highlightSkill: (row.highlight_skill as string | null) ?? null,
      coverImageUrl: (row.cover_image_url as string | null) ?? null,
      types,
      requirements,
      computedStatus: computed,
    };
  }
}

export class RegisterForEventUseCase {
  constructor(
    private readonly events: EventRepository,
    private readonly registrations: RegistrationRepository,
  ) {}

  async execute(
    eventId: number,
    userId: number,
    body: { participantRole?: string; agreedResponsibility: boolean },
  ) {
    const ev = await this.events.findById(eventId);
    if (!ev || ev.status !== "published") throw new HttpError(404, "NOT_FOUND", "Evento não encontrado");

    const existing = await this.registrations.findByEventAndUser(eventId, userId);
    if (existing) throw new HttpError(409, "ALREADY_REGISTERED", "Você já está inscrito neste evento");

    if (ev.capacity !== null) {
      const used = await this.registrations.countActiveByEvent(eventId);
      if (used >= Number(ev.capacity)) {
        throw new HttpError(400, "CAPACITY_FULL", "Não há vagas disponíveis");
      }
    }

    if (!body.agreedResponsibility) {
      throw new HttpError(400, "TERMS_REQUIRED", "É necessário aceitar o termo de responsabilidade");
    }

    const regId = await this.registrations.insert({
      event_id: eventId,
      user_id: userId,
      status: "pending",
      participant_role: body.participantRole ?? null,
      agreed_responsibility_at: new Date(),
    });

    return {
      id: regId,
      eventId,
      status: "pending" as const,
      participantRole: body.participantRole ?? null,
      createdAt: new Date().toISOString(),
    };
  }
}
