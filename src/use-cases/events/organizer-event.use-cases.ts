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

function ensureValidEventDates(
  startsAt: Date,
  endsAt: Date | null,
): void {
  if (Number.isNaN(startsAt.getTime())) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Data de início inválida");
  }
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "Data de término inválida");
  }
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "A data de término deve ser maior que a data de início");
  }
}

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

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
    if (!row) throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
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
    const startsAt = new Date(body.startsAt);
    const endsAt = body.endsAt ? new Date(body.endsAt) : null;
    ensureValidEventDates(startsAt, endsAt);

    const typeIds = await this.lookups.findEventTypeIdsByCodes(body.typeCodes);
    if (typeIds.length !== body.typeCodes.length) {
      const validCodes = new Set(typeIds.map((type) => type.code));
      const invalidCodes = body.typeCodes.filter((code) => !validCodes.has(code));
      throw new HttpError(
        400,
        "INVALID_EVENT_TYPES",
        `Tipos de evento inválidos: ${invalidCodes.join(", ")}`,
      );
    }

    const reqIds = await this.lookups.findRequirementIdsByCodes(body.requirementCodes);
    if (reqIds.length !== body.requirementCodes.length) {
      const validCodes = new Set(reqIds.map((requirement) => requirement.code));
      const invalidCodes = body.requirementCodes.filter((code) => !validCodes.has(code));
      throw new HttpError(
        400,
        "INVALID_REQUIREMENTS",
        `Requisitos inválidos: ${invalidCodes.join(", ")}`,
      );
    }

    const eventId = await this.events.transaction(async (trx) => {
      const id = await this.events.insertEvent(trx, {
        organizer_id: userId,
        title: body.title,
        summary: body.summary,
        description: body.description ?? null,
        rules_terms: body.rulesTerms ?? null,
        starts_at: startsAt,
        ends_at: endsAt,
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
    if (!existing) throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
    const nextStartsAt = patch.startsAt !== undefined ? new Date(patch.startsAt) : new Date(existing.starts_at);
    const nextEndsAt = patch.endsAt !== undefined
      ? (patch.endsAt ? new Date(patch.endsAt) : null)
      : (existing.ends_at ? new Date(existing.ends_at) : null);
    ensureValidEventDates(nextStartsAt, nextEndsAt);

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
        const typeIds = await trx("event_types").whereIn("code", patch.typeCodes).select("id", "code");
        if (typeIds.length !== patch.typeCodes.length) {
          const validCodes = new Set(typeIds.map((type) => type.code));
          const invalidCodes = patch.typeCodes.filter((code) => !validCodes.has(code));
          throw new HttpError(
            400,
            "INVALID_EVENT_TYPES",
            `Tipos de evento inválidos: ${invalidCodes.join(", ")}`,
          );
        }
        await this.events.replaceEventTypes(
          trx,
          eventId,
          typeIds.map((t) => t.id),
        );
      }

      if (patch.requirementCodes !== undefined) {
        const reqIds = await trx("requirement_options").whereIn("code", patch.requirementCodes).select("id", "code");
        if (reqIds.length !== patch.requirementCodes.length) {
          const validCodes = new Set(reqIds.map((requirement) => requirement.code));
          const invalidCodes = patch.requirementCodes.filter((code) => !validCodes.has(code));
          throw new HttpError(
            400,
            "INVALID_REQUIREMENTS",
            `Requisitos inválidos: ${invalidCodes.join(", ")}`,
          );
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
  constructor(
    private readonly events: EventRepository,
    private readonly registrations: RegistrationRepository,
  ) {}

  async execute(userId: number, eventId: number): Promise<void> {
    const event = await this.events.findByOrganizerAndId(userId, eventId);
    if (!event) throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");

    if (event.status === "cancelled") {
      throw new HttpError(422, "EVENT_ALREADY_CANCELLED", "Evento já cancelado");
    }

    const startsAt = new Date(event.starts_at);
    const endsAt = event.ends_at ? new Date(event.ends_at) : null;
    if (
      Number.isNaN(startsAt.getTime()) ||
      (endsAt !== null && Number.isNaN(endsAt.getTime())) ||
      (endsAt !== null && endsAt.getTime() <= startsAt.getTime())
    ) {
      throw new HttpError(422, "INVALID_EVENT_DATES", "Corrija as datas do evento antes de remover");
    }

    const now = new Date();
    if ((endsAt !== null && endsAt < now) || (endsAt === null && startsAt < now)) {
      throw new HttpError(422, "EVENT_ENDED", "Não é possível remover evento encerrado");
    }

    const computed = computeEventStatus({
      status: event.status,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
    });

    if (computed === "ended") {
      throw new HttpError(422, "EVENT_ENDED", "Não é possível remover evento encerrado");
    }

    const totalRegistrations = await this.registrations.countByEvent(eventId);
    if (event.status === "published" || totalRegistrations > 0) {
      const n = await this.events.setStatus(userId, eventId, "cancelled");
      if (!n) throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
      return;
    }

    const n = await this.events.deleteByOrganizer(userId, eventId);
    if (!n) throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
  }
}

export class PublishEventUseCase {
  constructor(private readonly events: EventRepository) {}

  async execute(userId: number, eventId: number) {
    const event = await this.events.findByOrganizerAndId(userId, eventId);
    if (!event) throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");

    if (event.status === "cancelled") {
      throw new HttpError(422, "EVENT_CANCELLED", "Não é possível publicar evento cancelado");
    }

    if (event.status === "published") {
      throw new HttpError(422, "EVENT_ALREADY_PUBLISHED", "Evento já publicado");
    }

    const startsAt = new Date(event.starts_at);
    const endsAt = event.ends_at ? new Date(event.ends_at) : null;

    if (
      Number.isNaN(startsAt.getTime()) ||
      (endsAt !== null && Number.isNaN(endsAt.getTime())) ||
      (endsAt !== null && endsAt.getTime() <= startsAt.getTime())
    ) {
      throw new HttpError(422, "INVALID_EVENT_DATES", "Corrija as datas do evento antes de publicar");
    }

    const now = new Date();
    if ((endsAt !== null && endsAt < now) || (endsAt === null && startsAt < now)) {
      throw new HttpError(422, "EVENT_ENDED", "Não é possível publicar evento encerrado");
    }

    const computed = computeEventStatus({
      status: event.status,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
    });

    if (computed === "ended") {
      throw new HttpError(422, "EVENT_ENDED", "Não é possível publicar evento encerrado");
    }

    if (isBlank(event.title) || isBlank(event.summary)) {
      throw new HttpError(
        422,
        "EVENT_MISSING_REQUIRED_FIELDS",
        "Preencha título e resumo antes de publicar",
      );
    }

    if (!Boolean(event.is_remote) && isBlank(event.location_name)) {
      throw new HttpError(
        422,
        "EVENT_LOCATION_REQUIRED",
        "Informe o local do evento presencial antes de publicar",
      );
    }

    const types = await this.events.findTypesForEvent(eventId);
    if (types.length === 0) {
      throw new HttpError(
        422,
        "EVENT_TYPE_REQUIRED",
        "Informe ao menos um tipo de evento antes de publicar",
      );
    }

    const n = await this.events.setStatus(userId, eventId, "published");
    if (!n) throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
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
    if (!ev) throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");

    const rows = await this.registrations.listForOrganizerEvent(eventId);

    const data = rows.map((r) => {
      const city = (r.city as string | null) ?? "";
      const state = (r.state as string | null) ?? "";
      const cityUf = city && state ? `${city} / ${state}` : city || state || "";
      const status = r.status === "confirmed" || r.status === "pending" || r.status === "cancelled"
        ? r.status
        : "pending";

      return {
        id: String(Number(r.id)),
        name: String(r.name),
        role: (r.participant_role as string | null) ?? "",
        email: String(r.email),
        phone: (r.phone as string | null) ?? "",
        cityUf,
        registrationDate: new Date(r.created_at as string).toISOString(),
        status,
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
    await this.events.transaction(async (trx) => {
      const ev = await this.events.findByIdForUpdate(trx, eventId);
      if (!ev || Number(ev.organizer_id) !== organizerId) {
        throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
      }

      if (ev.status === "cancelled") {
        throw new HttpError(422, "EVENT_CANCELLED", "Não é possível alterar inscrição de evento cancelado");
      }

      const startsAt = new Date(ev.starts_at);
      const endsAt = ev.ends_at ? new Date(ev.ends_at) : null;
      if (
        Number.isNaN(startsAt.getTime()) ||
        (endsAt !== null && Number.isNaN(endsAt.getTime())) ||
        (endsAt !== null && endsAt.getTime() <= startsAt.getTime())
      ) {
        throw new HttpError(422, "INVALID_EVENT_DATES", "Corrija as datas do evento antes de alterar inscrições");
      }

      const now = new Date();
      if ((endsAt !== null && endsAt < now) || (endsAt === null && startsAt < now)) {
        throw new HttpError(422, "EVENT_ENDED", "Não é possível alterar inscrição de evento encerrado");
      }

      const registration = await this.registrations.findByEventAndIdForUpdate(eventId, registrationId, trx);
      if (!registration) {
        throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Inscrição não encontrada");
      }

      if (registration.status === status) {
        throw new HttpError(422, "REGISTRATION_STATUS_UNCHANGED", "Inscrição já está com este status");
      }

      if (registration.status === "cancelled") {
        throw new HttpError(422, "REGISTRATION_ALREADY_CANCELLED", "Não é possível reativar inscrição cancelada");
      }

      if (status === "confirmed" && ev.capacity !== null) {
        const activeRegistrations = await this.registrations.countActiveByEvent(eventId, trx);
        if (activeRegistrations > Number(ev.capacity)) {
          throw new HttpError(422, "CAPACITY_FULL", "A capacidade do evento já foi ultrapassada");
        }
      }

      const n = await this.registrations.updateStatus(eventId, registrationId, status, trx);
      if (!n) throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Inscrição não encontrada");
    });

    return { id: registrationId, status };
  }
}
