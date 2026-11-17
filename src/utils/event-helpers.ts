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

const BRAZIL_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Carga horária efetiva do evento (RC-03): a regra única usada no certificado e em "Horas doadas",
// para os dois nunca discordarem.
//   1. A informada pelo organizador, quando existe — vale para qualquer evento.
//   2. Senão, a duração do evento, se ele começa e termina no mesmo dia no horário de Brasília.
//      "Mesmo dia" é medido no fuso de Brasília porque as datas ficam em UTC: um evento das 20h às
//      23h vai das 23h às 2h em UTC e, medido em UTC, viraria "dois dias".
//   3. Senão (vários dias, ou sem horário de término), `null`: o certificado mostra só o período.
export function effectiveWorkloadHours(row: {
  workload_hours: string | number | null | undefined;
  starts_at: Date | string;
  ends_at: Date | string | null;
}): number | null {
  const informed = parseWorkloadHours(row.workload_hours);
  if (informed !== null) return informed;
  if (!row.ends_at) return null;

  const starts = new Date(row.starts_at);
  const ends = new Date(row.ends_at);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) {
    return null;
  }
  if (BRAZIL_DAY.format(starts) !== BRAZIL_DAY.format(ends)) return null;

  return Math.round(((ends.getTime() - starts.getTime()) / 3_600_000) * 100) / 100;
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
