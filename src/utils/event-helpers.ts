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

// `events.workload_hours` é DECIMAL(5,2), que o mysql2 entrega como texto ("4.50") para não perder
// precisão. A conversão para número acontece aqui, uma vez, para nenhuma resposta da API sair
// com a carga horária como string. `undefined` também vira `null`: é o que chega de uma consulta
// que não selecionou a coluna, e tratar como ausente é mais seguro que devolver `NaN`.
export function parseWorkloadHours(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
