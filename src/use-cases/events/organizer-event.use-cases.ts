import type { EventStatus } from "../../models/event.model";
import type { EventRepository } from "../../repositories/event.repository";
import type { LookupRepository } from "../../repositories/lookup.repository";
import type { RegistrationRepository } from "../../repositories/registration.repository";
import {
  classifyTimeFilter,
  computeEventStatus,
  organizerStatusLabel,
} from "../../utils/event-helpers";
import { HttpError } from "../../utils/http-error";

export class ListMyEventsUseCase {
  constructor(private readonly events: EventRepository) {}

  async execute(userId: number, filter?: "upcoming" | "past" | "ongoing") {
    const rows = await this.events.listByOrganizer(userId);

    const mapped = rows.map((row) => {
      const time = classifyTimeFilter({
        starts_at: row.starts_at as string,
        ends_at: (row.ends_at as string | null) ?? null,
      });
      const computed = computeEventStatus({
        status: row.status as string,
        starts_at: row.starts_at as string,
        ends_at: (row.ends_at as string | null) ?? null,
      });
      return {
        id: String(row.id),
        title: row.title as string,
        filter: time,
        statusLabel: organizerStatusLabel(computed),
        description: (row.description as string | null) ?? (row.summary as string),
        imageClassName: "from-teal-600 to-cyan-500",
        startsAt: new Date(row.starts_at as string).toISOString(),
        status: row.status as string,
      };
    });

    const filtered = filter ? mapped.filter((m) => m.filter === filter) : mapped;
    return { data: filtered };
  }
}

export class GetOrganizerEventUseCase {
  constructor(private readonly events: EventRepository) {}

  async execute(userId: number, eventId: number) {
    const row = await this.events.findByOrganizerAndId(userId, eventId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Evento não encontrado");
    const types = await this.events.findTypesForEvent(eventId);
    const requirements = await this.events.findRequirementsForEvent(eventId);
    const computed = computeEventStatus({
      status: row.status as string,
      starts_at: row.starts_at as string,
      ends_at: (row.ends_at as string | null) ?? null,
    });
    return {
      ...row,
      id: Number(row.id),
      types,
      requirements,
      computedStatus: computed,
    };
  }
}

export class CreateEventUseCase {
  constructor(
    private readonly events: EventRepository,
    private readonly lookups: LookupRepository,
  ) {}

  async execute(
    userId: number,
    body: {
      title: string;
      summary: string;
      description?: string | null;
      rulesTerms?: string | null;
      startsAt: string;
      endsAt?: string | null;
      locationName?: string | null;
      isRemote: boolean;
      capacity?: number | null;
      highlightSkill?: string | null;
      typeCodes: string[];
      requirementCodes: string[];
      publish: boolean;
      coverImageUrl?: string | null;
    },
  ) {
    const status: EventStatus = body.publish ? "published" : "draft";

    const typeIds = await this.lookups.findEventTypeIdsByCodes(body.typeCodes);
    if (typeIds.length !== body.typeCodes.length) {
      throw new HttpError(400, "INVALID_TYPES", "Um ou mais tipos de evento são inválidos");
    }

    const reqIds = await this.lookups.findRequirementIdsByCodes(body.requirementCodes);
    if (reqIds.length !== body.requirementCodes.length) {
      throw new HttpError(400, "INVALID_REQUIREMENTS", "Um ou mais requisitos são inválidos");
    }

    const eventId = await this.events.transaction(async (trx) => {
      const id = await this.events.insertEvent(trx, {
        organizer_id: userId,
        title: body.title,
        summary: body.summary,
        description: body.description ?? null,
        rules_terms: body.rulesTerms ?? null,
        starts_at: new Date(body.startsAt),
        ends_at: body.endsAt ? new Date(body.endsAt) : null,
        location_name: body.locationName ?? null,
        is_remote: body.isRemote,
        capacity: body.capacity ?? null,
        highlight_skill: body.highlightSkill ?? null,
        cover_image_url: body.coverImageUrl ?? null,
        status,
      });

      await this.events.replaceEventTypes(
        trx,
        id,
        typeIds.map((t) => t.id),
      );
      await this.events.replaceEventRequirements(
        trx,
        id,
        reqIds.map((r) => r.id),
      );
      return id;
    });

    return new GetOrganizerEventUseCase(this.events).execute(userId, eventId);
  }
}

export class UpdateEventUseCase {
  constructor(private readonly events: EventRepository) {}

  async execute(
    userId: number,
    eventId: number,
    patch: Partial<{
      title: string;
      summary: string;
      description: string | null;
      rulesTerms: string | null;
      startsAt: string;
      endsAt: string | null;
      locationName: string | null;
      isRemote: boolean;
      capacity: number | null;
      highlightSkill: string | null;
      coverImageUrl: string | null;
      typeCodes: string[];
      requirementCodes: string[];
      publish: boolean;
    }>,
  ) {
    const existing = await this.events.findByOrganizerAndId(userId, eventId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Evento não encontrado");

    await this.events.transaction(async (trx) => {
      const row: Record<string, unknown> = {};
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.summary !== undefined) row.summary = patch.summary;
      if (patch.description !== undefined) row.description = patch.description;
      if (patch.rulesTerms !== undefined) row.rules_terms = patch.rulesTerms;
      if (patch.startsAt !== undefined) row.starts_at = new Date(patch.startsAt);
      if (patch.endsAt !== undefined) row.ends_at = patch.endsAt ? new Date(patch.endsAt) : null;
      if (patch.locationName !== undefined) row.location_name = patch.locationName;
      if (patch.isRemote !== undefined) row.is_remote = patch.isRemote;
      if (patch.capacity !== undefined) row.capacity = patch.capacity;
      if (patch.highlightSkill !== undefined) row.highlight_skill = patch.highlightSkill;
      if (patch.coverImageUrl !== undefined) row.cover_image_url = patch.coverImageUrl;
      if (patch.publish !== undefined) row.status = patch.publish ? "published" : "draft";

      await this.events.updateEvent(trx, eventId, row);

      if (patch.typeCodes !== undefined) {
        const typeIds = await trx("event_types").whereIn("code", patch.typeCodes).select("id");
        if (typeIds.length !== patch.typeCodes.length) {
          throw new HttpError(400, "INVALID_TYPES", "Um ou mais tipos de evento são inválidos");
        }
        await this.events.replaceEventTypes(
          trx,
          eventId,
          typeIds.map((t) => t.id),
        );
      }

      if (patch.requirementCodes !== undefined) {
        const reqIds = await trx("requirement_options").whereIn("code", patch.requirementCodes).select("id");
        if (reqIds.length !== patch.requirementCodes.length) {
          throw new HttpError(400, "INVALID_REQUIREMENTS", "Um ou mais requisitos são inválidos");
        }
        await this.events.replaceEventRequirements(
          trx,
          eventId,
          reqIds.map((r) => r.id),
        );
      }
    });

    return new GetOrganizerEventUseCase(this.events).execute(userId, eventId);
  }
}

export class DeleteEventUseCase {
  constructor(private readonly events: EventRepository) {}

  async execute(userId: number, eventId: number): Promise<void> {
    const n = await this.events.deleteByOrganizer(userId, eventId);
    if (!n) throw new HttpError(404, "NOT_FOUND", "Evento não encontrado");
  }
}

export class PublishEventUseCase {
  constructor(private readonly events: EventRepository) {}

  async execute(userId: number, eventId: number) {
    const n = await this.events.setStatus(userId, eventId, "published");
    if (!n) throw new HttpError(404, "NOT_FOUND", "Evento não encontrado");
    return new GetOrganizerEventUseCase(this.events).execute(userId, eventId);
  }
}

export class ListOrganizerRegistrationsUseCase {
  constructor(
    private readonly events: EventRepository,
    private readonly registrations: RegistrationRepository,
  ) {}

  async execute(organizerId: number, eventId: number) {
    const ev = await this.events.findByOrganizerAndId(organizerId, eventId);
    if (!ev) throw new HttpError(404, "NOT_FOUND", "Evento não encontrado");

    const rows = await this.registrations.listForOrganizerEvent(eventId);

    const data = rows.map((r) => {
      const city = (r.city as string | null) ?? "";
      const state = (r.state as string | null) ?? "";
      const cityUf = city && state ? `${city} / ${state}` : city || state || "";
      return {
        id: String(r.id),
        name: r.name as string,
        role: (r.participant_role as string | null) ?? "",
        email: r.email as string,
        phone: (r.phone as string | null) ?? "",
        cityUf,
        registrationDate: new Date(r.created_at as string).toISOString(),
        status:
          r.status === "confirmed" ? "confirmed" : r.status === "pending" ? "pending" : "cancelled",
      };
    });

    return { data };
  }
}

export class UpdateRegistrationStatusUseCase {
  constructor(
    private readonly events: EventRepository,
    private readonly registrations: RegistrationRepository,
  ) {}

  async execute(
    organizerId: number,
    eventId: number,
    registrationId: number,
    status: "pending" | "confirmed" | "cancelled",
  ) {
    const ev = await this.events.findByOrganizerAndId(organizerId, eventId);
    if (!ev) throw new HttpError(404, "NOT_FOUND", "Evento não encontrado");

    const n = await this.registrations.updateStatus(eventId, registrationId, status);
    if (!n) throw new HttpError(404, "NOT_FOUND", "Inscrição não encontrada");
    return { id: registrationId, status };
  }
}
