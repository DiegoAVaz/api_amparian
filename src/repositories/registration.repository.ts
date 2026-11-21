import type { Knex } from "knex";
import type { EventRegistrationRecord, RegistrationStatus } from "../models/registration.model";
import { firstCount } from "../utils/knex-helpers";

export class RegistrationRepository {
  constructor(private readonly db: Knex) {}

  async findByEventAndUser(
    eventId: number,
    userId: number,
    db: Knex = this.db,
  ): Promise<EventRegistrationRecord | undefined> {
    return db<EventRegistrationRecord>("event_registrations").where({ event_id: eventId, user_id: userId }).first();
  }

  async countActiveByEvent(eventId: number, db: Knex = this.db): Promise<number> {
    const countRows = await db("event_registrations")
      .where({ event_id: eventId })
      .whereIn("status", ["pending", "confirmed"])
      .count("* as count");
    return firstCount(countRows);
  }

  async countByEvent(eventId: number, db: Knex = this.db): Promise<number> {
    const countRows = await db("event_registrations")
      .where({ event_id: eventId })
      .count("* as count");
    return firstCount(countRows);
  }

  async insert(input: {
    event_id: number;
    user_id: number;
    status: RegistrationStatus;
    participant_role: string | null;
    agreed_responsibility_at: Date | null;
  }, db: Knex = this.db): Promise<number> {
    const insertResult = await db("event_registrations").insert(input);
    return Number(Array.isArray(insertResult) ? insertResult[0] : insertResult);
  }

  async listForOrganizerEvent(eventId: number): Promise<
    Array<{
      id: number;
      status: string;
      participant_role: string | null;
      created_at: string | Date;
      name: string;
      email: string;
      phone: string | null;
      city: string | null;
      state: string | null;
      attendance_status: string | null;
      certificate_id: number | null;
    }>
  > {
    // `leftJoin` porque a maioria dos inscritos ainda não tem presença lançada; a falta da linha
    // vira `attendance_status` nulo, e não some com o inscrito da lista.
    return this.db("event_registrations as er")
      .join("users as u", "er.user_id", "u.id")
      .leftJoin("event_attendances as ea", "ea.registration_id", "er.id")
      // Quem já emitiu o certificado: a lista de presença trava essas linhas (RC-04).
      .leftJoin("certificates as c", "c.registration_id", "er.id")
      .where("er.event_id", eventId)
      .orderBy("er.created_at", "asc")
      .orderBy("er.id", "asc")
      .select(
        "er.id",
        "er.status",
        "er.participant_role",
        "er.created_at",
        "u.name",
        "u.email",
        "u.phone",
        "u.city",
        "u.state",
        "ea.status as attendance_status",
        "c.id as certificate_id",
      );
  }

  async findByEventAndIdForUpdate(
    eventId: number,
    registrationId: number,
    trx: Knex,
  ): Promise<EventRegistrationRecord | undefined> {
    return trx<EventRegistrationRecord>("event_registrations")
      .where({ id: registrationId, event_id: eventId })
      .forUpdate()
      .first();
  }

  // O evento de uma inscrição do próprio usuário, sem trava: a emissão precisa dele para travar o
  // evento antes da inscrição. `undefined` quando a inscrição não existe ou é de outra pessoa.
  async findEventIdForUser(
    userId: number,
    registrationId: number,
  ): Promise<number | undefined> {
    const row = await this.db("event_registrations")
      .where({ id: registrationId, user_id: userId })
      .first("event_id");
    return row ? Number(row.event_id) : undefined;
  }

  // A inscrição do próprio usuário, travada até o fim da transação. A emissão do certificado trava
  // a mesma linha que a lista de presença trava (`findByEventAndIdsForUpdate`): as duas operações
  // se enfileiram, e a presença nunca muda entre a conferência ("está presente?") e a emissão.
  // Precisa vir antes de qualquer leitura comum da transação (só a trava do evento vem antes dela):
  // no InnoDB, o que a transação enxerga nas leituras comuns é fixado na primeira delas, e só assim
  // elas veem o que foi gravado enquanto se esperava a trava.
  async findByIdForUserForUpdate(
    userId: number,
    registrationId: number,
    trx: Knex,
  ): Promise<EventRegistrationRecord | undefined> {
    return trx<EventRegistrationRecord>("event_registrations")
      .where({ id: registrationId, user_id: userId })
      .forUpdate()
      .first();
  }

  // Inscrições do evento entre os ids pedidos, travadas até o fim da transação: o status não
  // pode mudar entre a conferência ("está confirmada?") e a gravação da presença.
  async findByEventAndIdsForUpdate(
    eventId: number,
    registrationIds: number[],
    trx: Knex,
  ): Promise<EventRegistrationRecord[]> {
    if (registrationIds.length === 0) return [];
    return trx<EventRegistrationRecord>("event_registrations")
      .where({ event_id: eventId })
      .whereIn("id", registrationIds)
      .forUpdate();
  }

  async updateStatus(
    eventId: number,
    registrationId: number,
    status: RegistrationStatus,
    db: Knex = this.db,
  ): Promise<number> {
    return db("event_registrations")
      .where({ id: registrationId, event_id: eventId })
      .update({ status });
  }

  async listForUserPaginated(userId: number, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const q = this.db("event_registrations as er")
      .join("events as e", "er.event_id", "e.id")
      .join("users as u", "e.organizer_id", "u.id")
      .where("er.user_id", userId)
      .select(
        "er.id",
        "er.status",
        "e.id as event_id",
        "e.title",
        "e.starts_at",
        "u.public_organization_name",
        "u.name as organizer_name",
      )
      .orderBy("e.starts_at", "desc");

    const countRows = await q.clone().clearSelect().clearOrder().count("* as count");
    const total = firstCount(countRows);
    const rows = await q.limit(limit).offset(offset);
    return { rows, total };
  }

  async findForUserWithEvent(
    userId: number,
    registrationId: number,
  ): Promise<
    | {
        id: number;
        status: string;
        event_id: number;
        event_status: string;
        starts_at: string | Date;
        ends_at: string | Date | null;
      }
    | undefined
  > {
    return this.db("event_registrations as er")
      .join("events as e", "er.event_id", "e.id")
      .where("er.id", registrationId)
      .where("er.user_id", userId)
      .select(
        "er.id",
        "er.status",
        "er.event_id",
        "e.status as event_status",
        "e.starts_at",
        "e.ends_at",
      )
      .first();
  }

  async cancelForUser(userId: number, registrationId: number): Promise<number> {
    return this.db("event_registrations").where({ id: registrationId, user_id: userId }).update({ status: "cancelled" });
  }

  async agendaForUserMonth(userId: number, start: Date, end: Date): Promise<
    Array<{
      id: number;
      title: string;
      starts_at: string | Date;
      public_organization_name: string | null;
      organizer_name: string;
    }>
  > {
    return this.db("event_registrations as er")
      .join("events as e", "er.event_id", "e.id")
      .join("users as u", "e.organizer_id", "u.id")
      .where("er.user_id", userId)
      .whereIn("er.status", ["pending", "confirmed"])
      .where("e.status", "published")
      .whereBetween("e.starts_at", [start, end])
      .select("e.id", "e.title", "e.starts_at", "u.public_organization_name", "u.name as organizer_name")
      .orderBy("e.starts_at", "asc");
  }
}
