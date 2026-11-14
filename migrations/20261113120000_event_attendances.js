/**
 * Controle de presença e carga horária do evento — base dos certificados de participação.
 *
 * - `events.workload_hours`: carga horária do evento, igual para todos os presentes. Fica nula
 *   nos eventos que já existem; a faixa (maior que 0, até 500) e a exigência para publicar são
 *   validadas na aplicação (Zod e caso de uso), como as demais regras do schema.
 * - `event_attendances`: uma presença por inscrição. Tabela própria, e não colunas em
 *   `event_registrations`, porque inscrição e comparecimento são fatos distintos, registrados em
 *   momentos distintos por pessoas distintas — é a entidade `Presença` do DER do artigo (p25).
 *   Não guarda horas: a carga horária é do evento.
 *
 * Regras completas em docs/Backend/Certificados de Participação.md (RC-02 a RC-04).
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable("events", (t) => {
    t.decimal("workload_hours", 5, 2).nullable().after("capacity");
  });

  await knex.schema.createTable("event_attendances", (t) => {
    t.bigIncrements("id");
    t.bigInteger("registration_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("event_registrations")
      .onDelete("CASCADE");
    t.enum("status", ["present", "absent"]).notNullable();
    // Quem lançou a presença (o organizador do evento). CASCADE acompanha o resto do schema:
    // apagar o usuário já apaga os eventos dele e, por eles, as inscrições e presenças.
    t.bigInteger("recorded_by").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.dateTime("recorded_at", { precision: 3 }).notNullable();
    t.specificType("created_at", "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");
    t.specificType(
      "updated_at",
      "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
    );
    // Uma presença por inscrição: é o que torna o lançamento em lote um upsert idempotente.
    t.unique(["registration_id"], { indexName: "uq_attendance_registration" });
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("event_attendances");
  await knex.schema.alterTable("events", (t) => {
    t.dropColumn("workload_hours");
  });
};
