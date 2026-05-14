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
    }>
  > {
    return this.db("event_registrations as er")
      .join("users as u", "er.user_id", "u.id")
      .where("er.event_id", eventId)
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
      );
  }

  async updateStatus(eventId: number, registrationId: number, status: RegistrationStatus): Promise<number> {
    return this.db("event_registrations").where({ id: registrationId, event_id: eventId }).update({ status });
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
      .whereBetween("e.starts_at", [start, end])
      .select("e.id", "e.title", "e.starts_at", "u.public_organization_name", "u.name as organizer_name");
  }

  async countConfirmedRegistrationsByUser(userId: number): Promise<number> {
    const countRows = await this.db("event_registrations")
      .where({ user_id: userId, status: "confirmed" })
      .count("* as count");
    return firstCount(countRows);
  }

  async countDistinctCausesSupported(userId: number): Promise<number> {
    const raw = await this.db.raw(
      `SELECT COUNT(DISTINCT e.organizer_id) AS c
       FROM event_registrations er
       INNER JOIN events e ON e.id = er.event_id
       WHERE er.user_id = ? AND er.status = 'confirmed'`,
      [userId],
    );
    const causeRows = (raw as unknown as [Array<{ c: string | number }>, unknown])[0];
    return Number(causeRows?.[0]?.c ?? 0);
  }
}
