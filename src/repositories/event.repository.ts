import type { Knex } from "knex";
import type {
  EventRecord,
  EventStatus,
  LookupRow,
} from "../models/event.model";
import { firstCount } from "../utils/knex-helpers";

export class EventRepository {
  constructor(private readonly db: Knex) {}

  async findPublishedListRow(params: {
    q?: string;
    page: number;
    limit: number;
  }) {
    const offset = (params.page - 1) * params.limit;
    let q = this.db("events as e")
      .join("users as u", "e.organizer_id", "u.id")
      .where("e.status", "published")
      .select(
        "e.id",
        "e.title",
        "e.summary",
        "e.starts_at",
        "e.location_name",
        "e.is_remote",
        "e.capacity",
        "e.cover_image_url",
        "u.public_organization_name",
        "u.name as organizer_name",
      )
      .orderBy("e.starts_at", "asc");

    if (params.q?.trim()) {
      const term = `%${params.q.trim()}%`;
      q = q.andWhere(function () {
        void this.where("e.title", "like", term)
          .orWhere("e.summary", "like", term)
          .orWhere("u.name", "like", term);
      });
    }

    const countRows = await q
      .clone()
      .clearSelect()
      .clearOrder()
      .count("* as count");
    const total = firstCount(countRows);
    const rows = await q.limit(params.limit).offset(offset);
    return { rows, total };
  }

  async findPublishedByIdWithOrganizer(eventId: number): Promise<
    | (EventRecord & {
        public_organization_name: string | null;
        organizer_name: string;
      })
    | undefined
  > {
    const row = await this.db("events as e")
      .join("users as u", "e.organizer_id", "u.id")
      .where("e.id", eventId)
      .where("e.status", "published")
      .select(
        "e.id",
        "e.organizer_id",
        "e.title",
        "e.summary",
        "e.description",
        "e.rules_terms",
        "e.starts_at",
        "e.ends_at",
        "e.location_name",
        "e.is_remote",
        "e.capacity",
        "e.cover_image_url",
        "e.highlight_skill",
        "e.status",
        "e.created_at",
        "e.updated_at",
        "u.public_organization_name",
        "u.name as organizer_name",
      )
      .first();
    return row as
      | (EventRecord & {
          public_organization_name: string | null;
          organizer_name: string;
        })
      | undefined;
  }

  async findTypesForEvent(
    eventId: number,
  ): Promise<Pick<LookupRow, "code" | "label">[]> {
    return this.db("event_event_types as eet")
      .join("event_types as et", "eet.event_type_id", "et.id")
      .where("eet.event_id", eventId)
      .select("et.code", "et.label");
  }

  async findRequirementsForEvent(
    eventId: number,
  ): Promise<Pick<LookupRow, "code" | "label">[]> {
    return this.db("event_requirements as er")
      .join("requirement_options as ro", "er.requirement_id", "ro.id")
      .where("er.event_id", eventId)
      .select("ro.code", "ro.label");
  }

  async findById(eventId: number): Promise<EventRecord | undefined> {
    return this.db<EventRecord>("events").where({ id: eventId }).first();
  }

  async findByIdForUpdate(
    trx: Knex,
    eventId: number,
  ): Promise<EventRecord | undefined> {
    return trx<EventRecord>("events")
      .where({ id: eventId })
      .forUpdate()
      .first();
  }

  async findByOrganizerAndId(
    organizerId: number,
    eventId: number,
  ): Promise<EventRecord | undefined> {
    return this.db<EventRecord>("events")
      .where({ id: eventId, organizer_id: organizerId })
      .first();
  }

  async listByOrganizer(organizerId: number): Promise<EventRecord[]> {
    return this.db<EventRecord>("events")
      .where({ organizer_id: organizerId })
      .whereNot("status", "cancelled")
      .orderBy("starts_at", "desc");
  }

  async insertEvent(
    trx: Knex,
    input: {
      organizer_id: number;
      title: string;
      summary: string;
      description: string | null;
      rules_terms: string | null;
      starts_at: Date;
      ends_at: Date | null;
      location_name: string | null;
      is_remote: boolean;
      capacity: number | null;
      highlight_skill: string | null;
      status: EventStatus;
    },
  ): Promise<number> {
    const insertResult = await trx("events").insert(input);
    return Number(Array.isArray(insertResult) ? insertResult[0] : insertResult);
  }

  async updateEvent(
    trx: Knex,
    eventId: number,
    row: Record<string, unknown>,
  ): Promise<void> {
    if (Object.keys(row).length === 0) return;
    await trx("events").where({ id: eventId }).update(row);
  }

  async deleteByOrganizer(
    organizerId: number,
    eventId: number,
  ): Promise<number> {
    return this.db("events")
      .where({ id: eventId, organizer_id: organizerId })
      .delete();
  }

  async setStatus(
    organizerId: number,
    eventId: number,
    status: EventStatus,
  ): Promise<number> {
    return this.db("events")
      .where({ id: eventId, organizer_id: organizerId })
      .update({ status });
  }

  async setCoverImage(
    organizerId: number,
    eventId: number,
    value: string | null,
  ): Promise<number> {
    return this.db("events")
      .where({ id: eventId, organizer_id: organizerId })
      .update({ cover_image_url: value });
  }

  async replaceEventTypes(
    trx: Knex,
    eventId: number,
    eventTypeIds: number[],
  ): Promise<void> {
    await trx("event_event_types").where({ event_id: eventId }).delete();
    for (const tid of eventTypeIds) {
      await trx("event_event_types").insert({
        event_id: eventId,
        event_type_id: tid,
      });
    }
  }

  async replaceEventRequirements(
    trx: Knex,
    eventId: number,
    requirementIds: number[],
  ): Promise<void> {
    await trx("event_requirements").where({ event_id: eventId }).delete();
    for (const rid of requirementIds) {
      await trx("event_requirements").insert({
        event_id: eventId,
        requirement_id: rid,
      });
    }
  }

  async transaction<T>(fn: (trx: Knex) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  async countByOrganizer(organizerId: number): Promise<number> {
    const countRows = await this.db("events")
      .where({ organizer_id: organizerId })
      .count("* as count");
    return firstCount(countRows);
  }
}
