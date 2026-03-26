import type { LookupRepository } from "../../repositories/lookup.repository";

export class ListLookupsUseCase {
  constructor(private readonly lookups: LookupRepository) {}

  async execute() {
    const [eventTypes, requirementOptions] = await Promise.all([
      this.lookups.listEventTypes(),
      this.lookups.listRequirementOptions(),
    ]);

    return {
      eventTypes: eventTypes.map((row) => ({
        code: row.code,
        label: row.label,
      })),
      requirementOptions: requirementOptions.map((row) => ({
        code: row.code,
        label: row.label,
      })),
    };
  }
}
