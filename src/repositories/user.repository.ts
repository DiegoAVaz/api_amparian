import type { Knex } from "knex";
import type { UserPublicFields, UserRecord } from "../models/user.model";

export class UserRepository {
  constructor(private readonly db: Knex) {}

  async findById(id: number): Promise<UserPublicFields | undefined> {
    const row = await this.db("users")
      .where({ id })
      .select(
        "id",
        "email",
        "name",
        "phone",
        "city",
        "state",
        "bio",
        "plan",
        "public_organization_name",
        "avatar_url",
      )
      .first();
    return row as UserPublicFields | undefined;
  }

  async findByEmailWithPassword(email: string): Promise<UserRecord | undefined> {
    return this.db<UserRecord>("users").where({ email }).first();
  }

  async emailExists(email: string): Promise<boolean> {
    const row = await this.db("users").where({ email }).first("id");
    return row !== undefined;
  }

  async insertUser(input: {
    email: string;
    password_hash: string;
    name: string;
    phone: string | null;
  }): Promise<number> {
    const insertResult = await this.db("users").insert(input);
    return Number(Array.isArray(insertResult) ? insertResult[0] : insertResult);
  }

  async updatePassword(userId: number, password_hash: string): Promise<void> {
    await this.db("users").where({ id: userId }).update({ password_hash });
  }

  async updateProfile(userId: number, row: Record<string, unknown>): Promise<void> {
    if (Object.keys(row).length === 0) return;
    await this.db("users").where({ id: userId }).update(row);
  }
}
