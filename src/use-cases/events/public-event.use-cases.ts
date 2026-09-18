import { computeEventStatus } from "../../utils/event-helpers";
import { HttpError } from "../../utils/http-error";
import { organizerDisplayName } from "../../utils/organizer-name";
import type { EventRepository } from "../../repositories/event.repository";
import type { RegistrationRepository } from "../../repositories/registration.repository";
import { storageKeyOf } from "../../services/storage";
import type { PublicUrlResolver } from "../../services/storage";

function isDuplicateRegistrationError(error: unknown): boolean {
  const err = error as {
    code?: unknown;
    errno?: unknown;
    sqlMessage?: unknown;
  };
  return (
    err.code === "ER_DUP_ENTRY" ||
    err.errno === 1062 ||
    (typeof err.sqlMessage === "string" &&
      err.sqlMessage.includes("uq_registration_event_user"))
  );
}

export class ListPublicEventsUseCase {
  constructor(
    private readonly events: EventRepository,
    private readonly resolvePublicUrl: PublicUrlResolver,
  ) {}

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
      // A coluna guarda a chave do blob; a URL sai daqui. `imageKey` deixa de
      // ser um `null` fixo e passa a devolver o valor real.
      coverImageUrl: this.resolvePublicUrl(r.cover_image_url as string | null),
      imageKey: storageKeyOf(r.cover_image_url as string | null),
    }));

    return { data, meta: { page: params.page, limit: params.limit, total } };
  }
}

export class GetPublicEventUseCase {
  constructor(
    private readonly events: EventRepository,
    private readonly resolvePublicUrl: PublicUrlResolver,
  ) {}

  async execute(eventId: number) {
    const row = await this.events.findPublishedByIdWithOrganizer(eventId);
    if (!row)
      throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");

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
      endsAt: row.ends_at
        ? new Date(row.ends_at as string).toISOString()
        : null,
      locationName: (row.location_name as string | null) ?? null,
      isRemote: Boolean(row.is_remote),
      capacity: row.capacity === null ? null : Number(row.capacity),
      highlightSkill: (row.highlight_skill as string | null) ?? null,
      coverImageUrl: this.resolvePublicUrl(
        (row.cover_image_url as string | null) ?? null,
      ),
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
    let regId: number;
    try {
      regId = await this.events.transaction(async (trx) => {
        const ev = await this.events.findByIdForUpdate(trx, eventId);
        if (!ev || ev.status !== "published")
          throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");

        const computed = computeEventStatus(ev);
        if (computed === "ended") {
          throw new HttpError(422, "EVENT_ENDED", "Evento encerrado");
        }

        const existing = await this.registrations.findByEventAndUser(
          eventId,
          userId,
          trx,
        );
        if (existing)
          throw new HttpError(
            409,
            "ALREADY_REGISTERED",
            "Você já está inscrito neste evento",
          );

        if (ev.capacity !== null) {
          const used = await this.registrations.countActiveByEvent(
            eventId,
            trx,
          );
          if (used >= Number(ev.capacity)) {
            throw new HttpError(
              422,
              "CAPACITY_FULL",
              "Não há vagas disponíveis",
            );
          }
        }

        if (!body.agreedResponsibility) {
          throw new HttpError(
            400,
            "TERMS_REQUIRED",
            "É necessário aceitar o termo de responsabilidade",
          );
        }

        return this.registrations.insert(
          {
            event_id: eventId,
            user_id: userId,
            status: "pending",
            participant_role: body.participantRole ?? null,
            agreed_responsibility_at: new Date(),
          },
          trx,
        );
      });
    } catch (error) {
      if (isDuplicateRegistrationError(error)) {
        throw new HttpError(
          409,
          "ALREADY_REGISTERED",
          "Você já está inscrito neste evento",
        );
      }
      throw error;
    }

    return {
      id: regId,
      eventId,
      status: "pending" as const,
      participantRole: body.participantRole ?? null,
      createdAt: new Date().toISOString(),
    };
  }
}
