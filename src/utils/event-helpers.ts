export type ComputedEventStatus = "draft" | "cancelled" | "active" | "ongoing" | "ended";

export function computeEventStatus(row: {
  status: string;
  starts_at: Date | string;
  ends_at: Date | string | null;
}): ComputedEventStatus {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "draft") return "draft";
  const now = new Date();
  const starts = new Date(row.starts_at);
  const ends = row.ends_at ? new Date(row.ends_at) : null;
  if (starts > now) return "active";
  if (ends && ends < now) return "ended";
  if (!ends && starts < now) return "ended";
  return "ongoing";
}

export function organizerStatusLabel(computed: ComputedEventStatus): "Ativo" | "Encerrado" | "Em andamento" {
  if (computed === "ended") return "Encerrado";
  if (computed === "ongoing") return "Em andamento";
  return "Ativo";
}

export function classifyTimeFilter(row: {
  starts_at: Date | string;
  ends_at: Date | string | null;
}): "upcoming" | "past" | "ongoing" {
  const now = new Date();
  const starts = new Date(row.starts_at);
  const ends = row.ends_at ? new Date(row.ends_at) : null;
  if (starts > now) return "upcoming";
  if (ends && ends < now) return "past";
  if (!ends && starts < now) return "past";
  if (starts <= now && (!ends || ends >= now)) return "ongoing";
  return "past";
}
