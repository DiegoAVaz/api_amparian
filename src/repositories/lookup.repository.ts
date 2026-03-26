import type { Knex } from "knex";
import type { LookupRow } from "../models/event.model";

export class LookupRepository {
  constructor(private readonly db: Knex) {}

  async listEventTypes(): Promise<LookupRow[]> {
    return this.db<LookupRow>("event_types").select("id", "code", "label").orderBy("sort_order", "asc");
  }

  async listRequirementOptions(): Promise<LookupRow[]> {
    return this.db<LookupRow>("requirement_options").select("id", "code", "label").orderBy("label", "asc");
  }

  async findEventTypeIdsByCodes(codes: string[]): Promise<LookupRow[]> {
    if (codes.length === 0) return [];
    return this.db<LookupRow>("event_types").whereIn("code", codes).select("id", "code", "label");
  }

  async findRequirementIdsByCodes(codes: string[]): Promise<LookupRow[]> {
    if (codes.length === 0) return [];
    return this.db<LookupRow>("requirement_options").whereIn("code", codes).select("id", "code", "label");
  }
}
