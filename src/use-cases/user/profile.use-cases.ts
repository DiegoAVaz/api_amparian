import { toUserPublicDto } from "../../models/user.model";
import type { EventRepository } from "../../repositories/event.repository";
import type { RegistrationRepository } from "../../repositories/registration.repository";
import type { UserRepository } from "../../repositories/user.repository";
import { HttpError } from "../../utils/http-error";

export class GetProfileUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(userId: number) {
    const user = await this.users.findById(userId);
    if (!user) throw new HttpError(404, "NOT_FOUND", "Usuário não encontrado");
    return toUserPublicDto(user);
  }
}

export class UpdateProfileUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(
    userId: number,
    patch: Partial<{
      name: string;
      phone: string | null;
      city: string | null;
      state: string | null;
      bio: string | null;
      publicOrganizationName: string | null;
      avatarUrl: string | null;
    }>,
  ) {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.city !== undefined) row.city = patch.city;
    if (patch.state !== undefined) row.state = patch.state;
    if (patch.bio !== undefined) row.bio = patch.bio;
    if (patch.publicOrganizationName !== undefined) row.public_organization_name = patch.publicOrganizationName;
    if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;

    if (Object.keys(row).length === 0) {
      const user = await this.users.findById(userId);
      if (!user) throw new HttpError(404, "NOT_FOUND", "Usuário não encontrado");
      return toUserPublicDto(user);
    }

    await this.users.updateProfile(userId, row);
    const user = await this.users.findById(userId);
    if (!user) throw new HttpError(404, "NOT_FOUND", "Usuário não encontrado");
    return toUserPublicDto(user);
  }
}

export class GetProfileStatsUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly events: EventRepository,
    private readonly registrations: RegistrationRepository,
  ) {}

  async execute(userId: number) {
    const user = await this.users.findById(userId);
    if (!user) throw new HttpError(404, "NOT_FOUND", "Usuário não encontrado");

    const eventsCreated = await this.events.countByOrganizer(userId);
    const eventsAttended = await this.registrations.countConfirmedRegistrationsByUser(userId);
    const causesSupported = await this.registrations.countDistinctCausesSupported(userId);

    return {
      hoursDonated: 0,
      causesSupported,
      eventsAttended,
      eventsCreated,
    };
  }
}
