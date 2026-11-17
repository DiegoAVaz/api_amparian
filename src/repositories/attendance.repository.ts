import type { Knex } from "knex";
import type { AttendanceStatus } from "../models";

// Um evento em que o usuário esteve presente, com o que as métricas de impacto precisam (RC-10).
// As horas não são somadas no SQL: a carga efetiva depende de regra (informada ou calculada pela
// duração no horário de Brasília), e essa regra mora em uma função só, no TypeScript.
export type AttendedEventRow = {
  organizer_id: number;
  workload_hours: string | null;
  starts_at: Date | string;
  ends_at: Date | string | null;
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

  // Eventos em que o usuário esteve presente e que contam para as métricas (RC-10): presença
  // `present`, inscrição ainda confirmada, evento não cancelado — a mesma base do certificado.
  // Uma linha por evento, garantida pelos índices únicos de inscrição e de presença.
  async listAttendedEventsByUser(
    userId: number,
    db: Knex = this.db,
  ): Promise<AttendedEventRow[]> {
    return db("event_attendances as ea")
      .join("event_registrations as er", "er.id", "ea.registration_id")
      .join("events as e", "e.id", "er.event_id")
      .where("er.user_id", userId)
      .andWhere("ea.status", "present")
      .andWhere("er.status", "confirmed")
      .andWhereNot("e.status", "cancelled")
      .select("e.organizer_id", "e.workload_hours", "e.starts_at", "e.ends_at");
  }
}
