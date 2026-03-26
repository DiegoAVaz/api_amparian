export function organizerDisplayName(organizer: {
  public_organization_name: string | null;
  name: string;
}): string {
  return organizer.public_organization_name?.trim() || organizer.name;
}
