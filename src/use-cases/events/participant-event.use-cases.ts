import type { RegistrationRepository } from "../../repositories/registration.repository";
import { computeEventStatus } from "../../utils/event-helpers";
import { HttpError } from "../../utils/http-error";
import { organizerDisplayName } from "../../utils/organizer-name";

export class ListMyRegistrationsUseCase {
  constructor(private readonly registrations: RegistrationRepository) {}

  async execute(userId: number, page: number, limit: number) {
    const { rows, total } = await this.registrations.listForUserPaginated(userId, page, limit);

    const data = rows.map((r) => ({
      id: Number(r.id),
      status: r.status as string,
      event: {
        id: Number(r.event_id),
        title: r.title as string,
        org: organizerDisplayName({
          public_organization_name: r.public_organization_name as string | null,
          name: r.organizer_name as string,
        }),
        startsAt: new Date(r.starts_at as string).toISOString(),
      },
    }));

    return { data, meta: { page, limit, total } };
  }
}

export class CancelRegistrationUseCase {
  constructor(private readonly registrations: RegistrationRepository) {}

  async execute(userId: number, registrationId: number): Promise<void> {
    const registration = await this.registrations.findForUserWithEvent(userId, registrationId);

    if (!registration) {
      throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Inscrição não encontrada");
    }

    if (registration.status === "cancelled") {
      throw new HttpError(422, "REGISTRATION_ALREADY_CANCELLED", "Inscrição já cancelada");
    }

    const eventStatus = computeEventStatus({
      status: registration.event_status,
      starts_at: registration.starts_at,
      ends_at: registration.ends_at,
    });

    if (eventStatus === "ended") {
      throw new HttpError(422, "EVENT_ENDED", "Não é possível cancelar inscrição de evento encerrado");
    }

    const n = await this.registrations.cancelForUser(userId, registrationId);
    if (!n) throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Inscrição não encontrada");
  }
}

export class GetMyAgendaUseCase {
  constructor(private readonly registrations: RegistrationRepository) {}

  async execute(userId: number, year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const rows = await this.registrations.agendaForUserMonth(userId, start, end);

    const data = rows.map((r) => {
      const d = new Date(r.starts_at as string);
      return {
        eventId: Number(r.id),
        title: r.title as string,
        org: organizerDisplayName({
          public_organization_name: r.public_organization_name as string | null,
          name: r.organizer_name as string,
        }),
        startsAt: d.toISOString(),
        dayLabel: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" }),
      };
    });

    return { data };
  }
}
