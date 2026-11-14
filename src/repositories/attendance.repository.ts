import type { Knex } from "knex";
import type { AttendanceStatus } from "../models";
import { parseWorkloadHours } from "../utils/event-helpers";

// Métricas de impacto de quem participou (RC-10), todas a partir da mesma base: presenças
// registradas, em inscrições ainda confirmadas, de eventos que não foram cancelados.
export type AttendanceTotals = {
  eventsAttended: number;
  causesSupported: number;
  hoursDonated: number;
};

// O que o caso de uso manda gravar. Fica sem `id`, `created_at` e `updated_at` porque esses
// campos são do banco: aceitar o `EventAttendanceRecord` inteiro deixaria o chamador passar valores
// que o upsert sobrescreveria.
export type AttendanceUpsertInput = {
  registration_id: number;
  status: AttendanceStatus;
  recorded_by: number;
  recorded_at: Date;
};

export class AttendanceRepository {
  constructor(private readonly db: Knex) {}

  // Grava a presença de cada inscrição, ou atualiza a que já existe. No MySQL vira
  // `INSERT ... ON DUPLICATE KEY UPDATE`, disparado pelo índice único `uq_attendance_registration`
  // — é o que torna "Salvar presença" repetível sem duplicar linhas.
  async upsertMany(items: AttendanceUpsertInput[], db: Knex = this.db): Promise<void> {
    // `insert([])` gera SQL inválido no Knex; lista vazia simplesmente não tem o que gravar.
    if (items.length === 0) return;

    await db("event_attendances")
      .insert(items)
      .onConflict("registration_id")
      // Só o que pode mudar entre um salvamento e outro. `registration_id` e `created_at`
      // ficam fora do merge para a linha original não ser reescrita.
      .merge(["status", "recorded_by", "recorded_at"]);
  }

  // A presença não tem `event_id`: o evento é alcançado pela inscrição. As colunas vão
  // qualificadas porque as duas tabelas têm `status`.
  //
  // Só entram inscrições ainda confirmadas. A presença pode ter sido lançada com o evento em
  // andamento e a inscrição cancelada depois; a linha continua gravada, mas deixa de valer e não
  // aparece na lista do organizador.
  async listByEvent(
    eventId: number,
    db: Knex = this.db,
  ): Promise<Array<{ registration_id: number; status: AttendanceStatus }>> {
    return db("event_attendances as ea")
      .join("event_registrations as er", "er.id", "ea.registration_id")
      .where("er.event_id", eventId)
      .andWhere("er.status", "confirmed")
      .select("ea.registration_id", "ea.status");
  }

  // Uma consulta só para as três métricas, para elas nunca discordarem entre si. Regras do RC-10
  // (docs/Backend/Certificados de Participação.md): evento cancelado depois da presença sai das
  // métricas (como sai do certificado), e evento sem carga horária conta como frequentado e soma
  // 0 hora — `SUM` ignora o `NULL`.
  async totalsByUser(userId: number, db: Knex = this.db): Promise<AttendanceTotals> {
    const row = (await db("event_attendances as ea")
      .join("event_registrations as er", "er.id", "ea.registration_id")
      .join("events as e", "e.id", "er.event_id")
      .where("er.user_id", userId)
      .andWhere("ea.status", "present")
      .andWhere("er.status", "confirmed")
      .andWhereNot("e.status", "cancelled")
      .first(
        db.raw("COUNT(ea.id) AS events_attended"),
        db.raw("COUNT(DISTINCT e.organizer_id) AS causes_supported"),
        // Sem nenhuma presença, SUM devolve NULL; o COALESCE garante 0.
        db.raw("COALESCE(SUM(e.workload_hours), 0) AS hours_donated"),
      )) as
      | { events_attended: string | number; causes_supported: string | number; hours_donated: string | number }
      | undefined;

    // O mysql2 entrega COUNT e SUM de DECIMAL como texto; a conversão fica aqui, na borda.
    return {
      eventsAttended: Number(row?.events_attended ?? 0),
      causesSupported: Number(row?.causes_supported ?? 0),
      hoursDonated: parseWorkloadHours(row?.hours_donated) ?? 0,
    };
  }
}
