export type ComputedEventStatus =
  "draft" | "cancelled" | "active" | "ongoing" | "ended";

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

export function organizerStatusLabel(
  computed: ComputedEventStatus,
): "Ativo" | "Encerrado" | "Em andamento" {
  if (computed === "ended") return "Encerrado";
  if (computed === "ongoing") return "Em andamento";
  return "Ativo";
}

// `events.workload_hours` é DECIMAL(5,2), que o mysql2 entrega como texto ("4.50") para não perder
// precisão. A conversão para número acontece aqui, uma vez, para nenhuma resposta da API sair
// com a carga horária como string. `undefined` também vira `null`: é o que chega de uma consulta
// que não selecionou a coluna, e tratar como ausente é mais seguro que devolver `NaN`.
export function parseWorkloadHours(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const BRAZIL_LOCAL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DAY_MS = 24 * 3_600_000;

// Até que horário da madrugada seguinte um evento noturno ainda conta como "de um dia".
export const OVERNIGHT_END_LIMIT_MINUTES = 6 * 60;

function brazilLocal(date: Date): { day: string; minutes: number } {
  const parts = Object.fromEntries(
    BRAZIL_LOCAL.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * O evento é "de um dia" (RC-03)? Sim quando dura até 24h e termina no mesmo dia em que começa
 * OU na madrugada seguinte, até as 6h. Tudo no horário de Brasília, porque as datas ficam em UTC:
 * um evento das 20h às 23h vai das 23h às 2h em UTC e, medido em UTC, viraria "dois dias".
 *
 * A madrugada entrou em 17/11/2026, por decisão do usuário: um evento das 20h à 0h, ou das 22h às
 * 2h, é uma noite de trabalho, e não "de 8 a 9 de novembro" — ganha horário no certificado e
 * carga horária pela duração. Um evento que segue manhã adentro continua sendo de vários dias.
 */
export function isSingleDayEvent(starts: Date, ends: Date): boolean {
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()))
    return false;
  const duration = ends.getTime() - starts.getTime();
  if (duration <= 0 || duration > DAY_MS) return false;

  const start = brazilLocal(starts);
  const end = brazilLocal(ends);
  if (start.day === end.day) return true;
  return (
    end.day === nextDay(start.day) && end.minutes <= OVERNIGHT_END_LIMIT_MINUTES
  );
}

// Carga horária efetiva do evento (RC-03): a regra única usada no certificado e em "Horas doadas",
// para os dois nunca discordarem.
//   1. A informada pelo organizador, quando existe — vale para qualquer evento.
//   2. Senão, a duração do evento, se ele é "de um dia" (`isSingleDayEvent`).
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
  if (!isSingleDayEvent(starts, ends)) return null;

  return (
    Math.round(((ends.getTime() - starts.getTime()) / 3_600_000) * 100) / 100
  );
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

// Prazo para lançar ou corrigir a presença: 30 dias depois do fim do evento. Sem data de
// fim, conta do início — é o único marco que o evento tem. Mora aqui, e não no caso de uso da
// presença, porque "Meus certificados" usa o mesmo prazo para separar "Aguardando o organizador"
// de "Sem presença": os dois lados nunca podem discordar sobre quando a janela fecha.
export const ATTENDANCE_WINDOW_DAYS = 30;

export function attendanceWindowClosesAt(
  startsAt: Date,
  endsAt: Date | null,
): Date {
  return new Date(
    (endsAt ?? startsAt).getTime() + ATTENDANCE_WINDOW_DAYS * DAY_MS,
  );
}
