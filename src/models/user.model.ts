/** Entidade / registro persistido (snake_case alinhado ao MySQL) */
export type UserRecord = {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  bio: string | null;
  plan: "basic" | "pro";
  public_organization_name: string | null;
  avatar_url: string | null;
};

export type UserPublicFields = Omit<UserRecord, "password_hash">;

export type UserPublicDto = {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  bio: string | null;
  plan: "basic" | "pro";
  publicOrganizationName: string | null;
  avatarUrl: string | null;
};

export function toUserPublicDto(
  row: UserPublicFields,
  resolvePublicUrl: (value: string | null) => string | null,
): UserPublicDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    city: row.city,
    state: row.state,
    bio: row.bio,
    plan: row.plan,
    publicOrganizationName: row.public_organization_name,
    avatarUrl: resolvePublicUrl(row.avatar_url),
  };
}
