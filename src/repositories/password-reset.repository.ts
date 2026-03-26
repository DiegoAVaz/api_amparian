import type { Knex } from "knex";

export type PasswordResetRow = {
  id: number;
  user_id: number;
  expires_at: Date | string;
  used_at: Date | string | null;
};

export class PasswordResetRepository {
  constructor(private readonly db: Knex) {}

  async insert(input: { user_id: number; token_hash: string; expires_at: Date }): Promise<void> {
    await this.db("password_reset_tokens").insert(input);
  }

  async findByHash(token_hash: string): Promise<PasswordResetRow | undefined> {
    return this.db<PasswordResetRow>("password_reset_tokens").where({ token_hash }).first();
  }

  async markUsed(id: number): Promise<void> {
    await this.db("password_reset_tokens").where({ id }).update({ used_at: this.db.fn.now() });
  }
}
