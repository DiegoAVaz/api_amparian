import { toUserPublicDto } from "../../models/user.model";
import {
  buildAvatarKey,
  deleteBlobIfOurs,
  validateImage,
} from "../../services/storage";
import type { PublicUrlResolver, Storage } from "../../services/storage";
import type { AttendanceRepository } from "../../repositories/attendance.repository";
import type { EventRepository } from "../../repositories/event.repository";
import type { UserRepository } from "../../repositories/user.repository";
import { effectiveWorkloadHours } from "../../utils/event-helpers";
import { HttpError } from "../../utils/http-error";

function userNotFoundError(): HttpError {
  return new HttpError(404, "USER_NOT_FOUND", "Usuário não encontrado");
}

export class GetProfileUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly resolvePublicUrl: PublicUrlResolver,
  ) {}

  async execute(userId: number) {
    const user = await this.users.findById(userId);
    if (!user) throw userNotFoundError();
    return toUserPublicDto(user, this.resolvePublicUrl);
  }
}

export class UpdateProfileUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly resolvePublicUrl: PublicUrlResolver,
  ) {}

  async execute(
    userId: number,
    patch: Partial<{
      name: string;
      phone: string | null;
      city: string | null;
      state: string | null;
      bio: string | null;
      publicOrganizationName: string | null;
    }>,
  ) {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.city !== undefined) row.city = patch.city;
    if (patch.state !== undefined) row.state = patch.state;
    if (patch.bio !== undefined) row.bio = patch.bio;
    if (patch.publicOrganizationName !== undefined)
      row.public_organization_name = patch.publicOrganizationName;

    if (Object.keys(row).length === 0) {
      const user = await this.users.findById(userId);
      if (!user) throw userNotFoundError();
      return toUserPublicDto(user, this.resolvePublicUrl);
    }

    await this.users.updateProfile(userId, row);
    const user = await this.users.findById(userId);
    if (!user) throw userNotFoundError();
    return toUserPublicDto(user, this.resolvePublicUrl);
  }
}

export class GetProfileStatsUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly events: EventRepository,
    private readonly attendances: AttendanceRepository,
  ) {}

  async execute(userId: number) {
    const user = await this.users.findById(userId);
    if (!user) throw userNotFoundError();

    const eventsCreated = await this.events.countByOrganizer(userId);
    // Horas, eventos frequentados e causas apoiadas vêm da presença registrada pelo organizador
    // (RC-10), e não mais de inscrições confirmadas — que contavam até eventos que nem aconteceram.
    const attended = await this.attendances.listAttendedEventsByUser(userId);

    // Toda participação conta como evento frequentado, com ou sem carga horária: o voluntário nunca
    // deixa de mostrar que participou. As horas somam só a carga efetiva conhecida (RC-03) — evento
    // de vários dias sem carga informada soma 0, igual ao certificado, que mostra só o período.
    const eventsAttended = attended.length;
    const causesSupported = new Set(attended.map((row) => Number(row.organizer_id))).size;
    const totalHours = attended.reduce(
      (sum, row) => sum + (effectiveWorkloadHours(row) ?? 0),
      0,
    );
    // Arredonda a soma em duas casas para não exibir resíduo de ponto flutuante (0,1 + 0,2).
    const hoursDonated = Math.round(totalHours * 100) / 100;

    return {
      hoursDonated,
      causesSupported,
      eventsAttended,
      eventsCreated,
    };
  }
}

async function deleteBlobIfWriteDidNotApply(
  users: UserRepository,
  storage: Storage,
  ref: { userId: number; key: string },
): Promise<void> {
  try {
    const row = await users.findById(ref.userId);
    if (row?.avatar_url === ref.key) return;
  } catch {
    return;
  }
  await deleteBlobIfOurs(storage, ref.key);
}

export class UploadAvatarUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly storage: Storage,
    private readonly resolvePublicUrl: PublicUrlResolver,
    private readonly maxBytes: number,
  ) {}

  async execute(userId: number, buffer: Buffer) {
    const image = validateImage(buffer, this.maxBytes);

    const before = await this.users.findById(userId);
    if (!before) throw userNotFoundError();

    const key = buildAvatarKey(userId, image);
    await this.storage.put(key, image);

    let changed: number;
    try {
      changed = await this.users.setAvatar(userId, key);
    } catch (error) {
      await deleteBlobIfWriteDidNotApply(this.users, this.storage, {
        userId,
        key,
      });
      throw error;
    }

    if (!changed) {
      await deleteBlobIfOurs(this.storage, key);
      throw userNotFoundError();
    }

    await deleteBlobIfOurs(this.storage, before.avatar_url);

    const user = await this.users.findById(userId);
    if (!user) throw userNotFoundError();
    return toUserPublicDto(user, this.resolvePublicUrl);
  }
}

export class DeleteAvatarUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly storage: Storage,
    private readonly resolvePublicUrl: PublicUrlResolver,
  ) {}

  async execute(userId: number) {
    const before = await this.users.findById(userId);
    if (!before) throw userNotFoundError();

    const changed = await this.users.setAvatar(userId, null);
    if (!changed) {
      await deleteBlobIfOurs(this.storage, before.avatar_url);
      throw userNotFoundError();
    }

    await deleteBlobIfOurs(this.storage, before.avatar_url);

    const user = await this.users.findById(userId);
    if (!user) throw userNotFoundError();
    return toUserPublicDto(user, this.resolvePublicUrl);
  }
}
