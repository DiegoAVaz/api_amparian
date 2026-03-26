import type { Knex } from "knex";

export type RefreshTokenRow = {
  id: number;
  user_id: number;
  expires_at: Date | string;
  revoked_at: Date | string | null;
};

export class RefreshTokenRepository {
  constructor(private readonly db: Knex) {}

  async insert(input: {
    user_id: number;
    token_hash: string;
    expires_at: Date;
    user_agent?: string | null;
    ip_address?: string | null;
  }): Promise<void> {
    await this.db("refresh_tokens").insert({
      user_id: input.user_id,
      token_hash: input.token_hash,
      expires_at: input.expires_at,
      user_agent: input.user_agent ?? null,
      ip_address: input.ip_address ?? null,
    });
  }

  async findByHash(token_hash: string): Promise<RefreshTokenRow | undefined> {
    return this.db<RefreshTokenRow>("refresh_tokens").where({ token_hash }).first();
  }

  async revokeById(id: number): Promise<void> {
    await this.db("refresh_tokens").where({ id }).update({ revoked_at: this.db.fn.now() });
  }

  async revokeByHash(token_hash: string): Promise<void> {
    await this.db("refresh_tokens").where({ token_hash }).update({ revoked_at: this.db.fn.now() });
  }
}
