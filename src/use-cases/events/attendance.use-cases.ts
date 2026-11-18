import type { AttendanceStatus } from "../../models";
import type { AttendanceRepository } from "../../repositories/attendance.repository";
import type { CertificateRepository } from "../../repositories/certificate.repository";
import type { EventRepository } from "../../repositories/event.repository";
import type { RegistrationRepository } from "../../repositories/registration.repository";
import { HttpError } from "../../utils/http-error";
import { parseDbDate } from "../../utils/knex-helpers";

// Prazo para lançar ou corrigir a presença depois do fim do evento
export const ATTENDANCE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AttendanceItemInput = {
  registrationId: number;
  status: AttendanceStatus;
};

/**
 * Lista de chamada do organizador: grava em lote a presença das inscrições de um evento.
 *
 * Trava de RC-04: a presença de quem já emitiu o certificado não muda mais. Mandar "presente" de
 * novo para essa pessoa é aceito e ignorado — não muda nada, e um cliente que envie a lista
 * inteira não precisa saber quem está travado —, mas qualquer outra marcação é recusada, com os
 * ids travados nos detalhes do erro.
 */
export class RecordAttendanceUseCase {
  constructor(
    private readonly events: EventRepository,
    private readonly registrations: RegistrationRepository,
    private readonly attendances: AttendanceRepository,
    private readonly certificates: CertificateRepository,
  ) {}

  async execute(organizerId: number, eventId: number, items: AttendanceItemInput[]) {
    const registrationIds = items.map((item) => item.registrationId);

    // Dois status para a mesma inscrição no mesmo envio não têm resposta certa: qual vale?
    // Recusar é melhor que deixar a ordem do array decidir em silêncio.
    if (new Set(registrationIds).size !== registrationIds.length) {
      throw new HttpError(
        422,
        "ATTENDANCE_DUPLICATED_REGISTRATION",
        "Cada inscrição deve aparecer uma única vez na lista de presença",
      );
    }

    return this.events.transaction(async (trx) => {
      // Mesmo padrão de UpdateRegistrationStatusUseCase: trava o evento e responde 404 para evento
      // alheio, sem confirmar que ele existe (RN05).
      const ev = await this.events.findByIdForUpdate(trx, eventId);
      if (!ev || Number(ev.organizer_id) !== organizerId) {
        throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
      }

      if (ev.status === "cancelled") {
        throw new HttpError(
          422,
          "EVENT_CANCELLED",
          "Não é possível registrar presença em evento cancelado",
        );
      }

      const now = new Date();
      const startsAt = parseDbDate(ev.starts_at);
      const endsAt = ev.ends_at ? parseDbDate(ev.ends_at) : null;
      if (Number.isNaN(startsAt.getTime()) || (endsAt !== null && Number.isNaN(endsAt.getTime()))) {
        throw new HttpError(
          422,
          "INVALID_EVENT_DATES",
          "Corrija as datas do evento antes de registrar presença",
        );
      }

      if (now < startsAt) {
        throw new HttpError(
          422,
          "ATTENDANCE_NOT_OPEN",
          "A presença só pode ser registrada a partir do início do evento",
        );
      }

      // Sem data de fim, a janela conta a partir do início — é o único marco que o evento tem.
      const closesAt = new Date((endsAt ?? startsAt).getTime() + ATTENDANCE_WINDOW_DAYS * DAY_MS);
      if (now > closesAt) {
        // A mensagem diz de onde o prazo foi contado, porque evento sem data de fim conta do início.
        const reference = endsAt ? "o fim" : "o início";
        throw new HttpError(
          422,
          "ATTENDANCE_WINDOW_CLOSED",
          `O prazo para registrar presença terminou ${ATTENDANCE_WINDOW_DAYS} dias após ${reference} do evento`,
        );
      }

      const registrations = await this.registrations.findByEventAndIdsForUpdate(
        eventId,
        registrationIds,
        trx,
      );

      // Algum id não é deste evento (ou não existe). Responde 404 sem dizer qual, para não virar
      // um jeito de sondar inscrições de outros eventos.
      if (registrations.length !== registrationIds.length) {
        throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Inscrição não encontrada neste evento");
      }

      // Presença só faz sentido para quem teve a vaga aceita: inscrição pendente ou cancelada
      // aparece na tela como "Não se aplica".
      if (registrations.some((registration) => registration.status !== "confirmed")) {
        throw new HttpError(
          422,
          "REGISTRATION_NOT_CONFIRMED",
          "Só inscrições confirmadas podem receber presença",
        );
      }

      // As inscrições já estão travadas acima, e a emissão trava a mesma linha: entre esta consulta e
      // a gravação, ninguém emite um certificado novo para elas.
      //
      // A ordem importa. No InnoDB (REPEATABLE READ), a transação fixa o que enxerga na PRIMEIRA
      // leitura comum — não numa leitura com trava. Como as travas (`findByIdForUpdate` e
      // `findByEventAndIdsForUpdate`) vêm antes desta consulta, ela enxerga o certificado emitido
      // enquanto esperávamos a trava. Uma leitura comum antes das travas quebraria a RC-04.
      const issued = new Set(
        await this.certificates.findIssuedRegistrationIds(registrationIds, trx),
      );
      const locked = items
        .filter((item) => issued.has(item.registrationId) && item.status !== "present")
        .map((item) => item.registrationId);
      if (locked.length > 0) {
        // Os ids vão nos detalhes para a tela marcar as linhas travadas. São inscrições do próprio
        // evento do organizador, então nada vaza.
        throw new HttpError(
          422,
          "ATTENDANCE_LOCKED",
          "A presença de quem já emitiu o certificado não pode mais ser alterada",
          { context: { registrationIds: locked } },
        );
      }

      await this.attendances.upsertMany(
        items
          .filter((item) => !issued.has(item.registrationId))
          .map((item) => ({
            registration_id: item.registrationId,
            status: item.status,
            recorded_by: organizerId,
            recorded_at: now,
          })),
        trx,
      );

      // Devolve a lista inteira do evento, e não só o que veio no envio: a tela redesenha a
      // chamada a partir do estado gravado.
      const saved = await this.attendances.listByEvent(eventId, trx);
      return saved.map((row) => ({
        registrationId: Number(row.registration_id),
        status: row.status,
      }));
    });
  }
}
