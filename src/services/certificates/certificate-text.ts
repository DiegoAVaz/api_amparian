// Redação do certificado (seção 6 de docs/Backend/Certificados de Participação.md). Funções puras,
// separadas do desenho do PDF, para cada variante do texto ser testada sem gerar arquivo — e para a
// página pública de verificação poder usar a mesma redação.
//
// Toda data sai no horário de Brasília: as datas ficam em UTC no banco (ver Datas e Fuso Horário),
// e um evento das 20h às 23h viraria "das 23h às 2h" se fosse formatado em UTC.

import { isSingleDayEvent } from "../../utils/event-helpers";

const TIME_ZONE = "America/Sao_Paulo";

const PARTS = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

type LocalParts = {
  day: number;
  month: string;
  year: number;
  hour: number;
  minute: number;
};

function localParts(date: Date): LocalParts {
  const parts = Object.fromEntries(
    PARTS.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    day: Number(parts.day),
    month: parts.month,
    year: Number(parts.year),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

// "1º de novembro", como se escreve o primeiro dia do mês em português.
function dayLabel(day: number): string {
  return day === 1 ? "1º" : String(day);
}

function hourLabel({ hour, minute }: LocalParts): string {
  return minute === 0
    ? `${hour}h`
    : `${hour}h${String(minute).padStart(2, "0")}`;
}

// 0h e 1h são singulares em português: "da 1h", "à 0h", "a partir da 1h".
function isSingularHour(parts: LocalParts): boolean {
  return parts.hour < 2;
}

function fromHour(parts: LocalParts): string {
  return `${isSingularHour(parts) ? "da" : "das"} ${hourLabel(parts)}`;
}

function toHour(parts: LocalParts): string {
  return `${isSingularHour(parts) ? "à" : "às"} ${hourLabel(parts)}`;
}

function sameDay(a: LocalParts, b: LocalParts): boolean {
  return a.day === b.day && a.month === b.month && a.year === b.year;
}

/** "8 de novembro de 2026", no horário de Brasília. */
export function formatLongDate(date: Date): string {
  const parts = localParts(date);
  return `${dayLabel(parts.day)} de ${parts.month} de ${parts.year}`;
}

/**
 * O trecho que segue "realizada" no parágrafo do certificado.
 *
 * - Um dia, com término: "em 8 de novembro de 2026, das 8h às 12h".
 * - Noite que termina na madrugada seguinte, que também é "de um dia" (`isSingleDayEvent`, RC-03):
 *   "das 20h à 0h", ou "das 22h às 2h do dia seguinte" quando passa da meia-noite.
 * - Sem término: "em 8 de novembro de 2026, a partir das 8h" — diz o que se sabe, o início, sem
 *   inventar um fim (decisão de 17/11/2026).
 * - Vários dias: "de 6 a 8 de novembro de 2026", sem horário, como no desenho aprovado. Repete o
 *   mês e o ano só quando mudam.
 */
export function formatEventPeriod(startsAt: Date, endsAt: Date | null): string {
  const start = localParts(startsAt);

  if (!endsAt) {
    return `em ${formatLongDate(startsAt)}, a partir ${fromHour(start)}`;
  }

  const end = localParts(endsAt);
  if (isSingleDayEvent(startsAt, endsAt)) {
    // Terminar à 0h em ponto é o fim do próprio dia; depois disso, o "do dia seguinte" evita que
    // "das 22h às 2h" pareça um evento de 20 horas.
    // Exceção: 0h → 0h é o dia inteiro, e "da 0h à 0h" leria como duração zero.
    const endsAtMidnight = end.hour === 0 && end.minute === 0;
    const startsAtMidnight = start.hour === 0 && start.minute === 0;
    const crossesMidnight =
      !sameDay(start, end) && (!endsAtMidnight || startsAtMidnight);
    const suffix = crossesMidnight ? " do dia seguinte" : "";
    return `em ${formatLongDate(startsAt)}, ${fromHour(start)} ${toHour(end)}${suffix}`;
  }
  if (start.year !== end.year) {
    return `de ${formatLongDate(startsAt)} a ${formatLongDate(endsAt)}`;
  }
  if (start.month !== end.month) {
    return `de ${dayLabel(start.day)} de ${start.month} a ${dayLabel(end.day)} de ${end.month} de ${end.year}`;
  }
  return `de ${dayLabel(start.day)} a ${dayLabel(end.day)} de ${end.month} de ${end.year}`;
}

/**
 * Carga horária por extenso: "4 horas", "1 hora", "2 horas e 30 minutos", "30 minutos".
 * A carga é decimal (3,5 = 3h30); a fração vira minutos arredondados, porque "3,33 horas" não é
 * como alguém lê um certificado.
 */
export function formatWorkload(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const hoursText = `${h} ${h === 1 ? "hora" : "horas"}`;
  const minutesText = `${m} ${m === 1 ? "minuto" : "minutos"}`;
  if (h === 0) return minutesText;
  if (m === 0) return hoursText;
  return `${hoursText} e ${minutesText}`;
}

/**
 * O local, já com a preposição. "em {local}" e não "no {local}": o nome é texto livre, e "no Praça
 * da Sé" sairia errado (decisão de 17/11/2026). `null` quando não há o que dizer.
 */
export function formatLocation(
  locationName: string | null,
  isRemote: boolean,
): string | null {
  if (isRemote) return "de forma remota";
  const name = locationName?.trim();
  return name ? `em ${name}` : null;
}

/** "R4WT8HZN2QKC" → "R4WT-8HZN-2QKC". O hífen é só apresentação (RC-07). */
export function formatVerificationCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

export type CertificateTextData = {
  eventTitle: string;
  organizerName: string;
  eventStartsAt: Date;
  eventEndsAt: Date | null;
  eventLocationName: string | null;
  eventIsRemote: boolean;
  workloadHours: number | null;
};

/** Um trecho do parágrafo; `strong` são os trechos em destaque (semibold, teal). */
export type TextRun = { text: string; strong: boolean };

/**
 * O parágrafo principal, em trechos com e sem destaque. Duas variantes (seção 6):
 * - com carga horária: "..., com carga horária de **4 horas**."
 * - sem carga horária: termina no local (ou no período, sem local). Nunca "0 horas" nem campo vazio.
 */
export function buildCertificateParagraph(
  data: CertificateTextData,
): TextRun[] {
  const plain = (text: string): TextRun => ({ text, strong: false });
  const strong = (text: string): TextRun => ({ text, strong: true });

  const tail = [
    `realizada ${formatEventPeriod(data.eventStartsAt, data.eventEndsAt)}`,
  ];
  const location = formatLocation(data.eventLocationName, data.eventIsRemote);
  if (location) tail.push(location);

  const runs: TextRun[] = [
    plain("participou de forma voluntária da ação "),
    strong(data.eventTitle),
    plain(", promovida por "),
    strong(data.organizerName),
    plain(`, ${tail.join(", ")}`),
  ];

  // Confere os minutos já arredondados, e não as horas cruas: menos de 30 segundos sairia
  // "0 minutos".
  if (data.workloadHours !== null && Math.round(data.workloadHours * 60) > 0) {
    runs.push(plain(", com carga horária de "));
    runs.push(strong(formatWorkload(data.workloadHours)));
  }
  runs.push(plain("."));
  return runs;
}
