/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("certificates", (t) => {
    t.bigIncrements("id");
    t.bigInteger("registration_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("event_registrations")
      .onDelete("RESTRICT");
    // Sempre exatamente 12 caracteres, por isso CHAR, como `token_hash CHAR(64)`. A busca não
    // depende da colação do banco para ignorar maiúsculas: quem consulta normaliza antes (RC-07).
    t.specificType("verification_code", "CHAR(12)").notNullable();

    // Snapshot (RC-06). Tamanhos iguais aos das colunas de origem.
    t.string("participant_name", 255).notNullable();
    t.string("event_title", 255).notNullable();
    // "Promovida por": a organização pública do organizador ou, sem ela, o nome dele.
    t.string("organizer_name", 255).notNullable();
    // "Organizador(a) responsável": sempre o nome da pessoa.
    t.string("organizer_person_name", 255).notNullable();
    t.dateTime("event_starts_at", { precision: 3 }).notNullable();
    t.dateTime("event_ends_at", { precision: 3 }).nullable();
    t.string("event_location_name", 255).nullable();
    t.boolean("event_is_remote").notNullable();
    t.decimal("event_workload_hours", 5, 2).nullable();

    // 255 é o teto de `assertSafeStorageKey`.
    t.string("blob_key", 255).nullable();
    t.dateTime("issued_at", { precision: 3 }).notNullable();
    t.specificType("created_at", "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");
    t.specificType(
      "updated_at",
      "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
    );

    // Um certificado por inscrição: pedir de novo devolve o mesmo (RC-05).
    t.unique(["registration_id"], { indexName: "uq_certificate_registration" });
    // A verificação pública busca por aqui; o UNIQUE também é o índice.
    t.unique(["verification_code"], { indexName: "uq_certificate_code" });
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("certificates");
};
