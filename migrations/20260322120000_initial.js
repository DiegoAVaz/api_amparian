/**
 * Schema alinhado a docs/ddl.sql
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("SET NAMES utf8mb4");
  await knex.raw("SET FOREIGN_KEY_CHECKS = 0");

  await knex.schema.createTable("event_types", (t) => {
    t.increments("id").unsigned();
    t.string("code", 64).notNullable().unique();
    t.string("label", 128).notNullable();
    t.integer("sort_order").unsigned().notNullable().defaultTo(0);
  });

  await knex.schema.createTable("requirement_options", (t) => {
    t.increments("id").unsigned();
    t.string("code", 64).notNullable().unique();
    t.string("label", 128).notNullable();
  });

  await knex.schema.createTable("users", (t) => {
    t.bigIncrements("id");
    t.string("email", 255).notNullable().unique();
    t.string("password_hash", 255).notNullable();
    t.string("name", 255).notNullable();
    t.string("phone", 32).nullable();
    t.string("city", 128).nullable();
    t.specificType("state", "CHAR(2)").nullable();
    t.text("bio").nullable();
    t.string("avatar_url", 512).nullable();
    t.string("public_organization_name", 255).nullable();
    t.enum("plan", ["basic", "pro"]).notNullable().defaultTo("basic");
    t.specificType("created_at", "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");
    t.specificType(
      "updated_at",
      "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
    );
  });

  await knex.schema.createTable("password_reset_tokens", (t) => {
    t.bigIncrements("id");
    t.bigInteger("user_id").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.specificType("token_hash", "CHAR(64)").notNullable().unique();
    t.dateTime("expires_at", { precision: 3 }).notNullable();
    t.dateTime("used_at", { precision: 3 }).nullable();
    t.specificType("created_at", "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");
  });

  await knex.schema.createTable("refresh_tokens", (t) => {
    t.bigIncrements("id");
    t.bigInteger("user_id").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.specificType("token_hash", "CHAR(64)").notNullable().unique();
    t.dateTime("expires_at", { precision: 3 }).notNullable();
    t.dateTime("revoked_at", { precision: 3 }).nullable();
    t.specificType("created_at", "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");
    t.string("user_agent", 512).nullable();
    t.string("ip_address", 45).nullable();
  });

  await knex.schema.createTable("events", (t) => {
    t.bigIncrements("id");
    t.bigInteger("organizer_id").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("title", 255).notNullable();
    t.text("summary").notNullable();
    t.text("description").nullable();
    t.text("rules_terms").nullable();
    t.dateTime("starts_at", { precision: 3 }).notNullable();
    t.dateTime("ends_at", { precision: 3 }).nullable();
    t.string("location_name", 255).nullable();
    t.boolean("is_remote").notNullable().defaultTo(false);
    t.integer("capacity").unsigned().nullable();
    t.string("cover_image_url", 512).nullable();
    t.string("highlight_skill", 255).nullable();
    t.enum("status", ["draft", "published", "cancelled"]).notNullable().defaultTo("draft");
    t.specificType("created_at", "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");
    t.specificType(
      "updated_at",
      "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
    );
    t.index(["organizer_id"], "ix_events_organizer");
    t.index(["starts_at"], "ix_events_starts");
    t.index(["status", "starts_at"], "ix_events_status_starts");
  });

  await knex.raw("ALTER TABLE events ADD FULLTEXT INDEX ft_events_search (title, summary)");

  await knex.schema.createTable("event_event_types", (t) => {
    t.bigInteger("event_id").unsigned().notNullable().references("id").inTable("events").onDelete("CASCADE");
    t.integer("event_type_id").unsigned().notNullable().references("id").inTable("event_types").onDelete("RESTRICT");
    t.primary(["event_id", "event_type_id"]);
    t.index(["event_type_id"], "ix_eet_type");
  });

  await knex.schema.createTable("event_requirements", (t) => {
    t.bigInteger("event_id").unsigned().notNullable().references("id").inTable("events").onDelete("CASCADE");
    t.integer("requirement_id").unsigned().notNullable().references("id").inTable("requirement_options").onDelete("RESTRICT");
    t.primary(["event_id", "requirement_id"]);
  });

  await knex.schema.createTable("event_registrations", (t) => {
    t.bigIncrements("id");
    t.bigInteger("event_id").unsigned().notNullable().references("id").inTable("events").onDelete("CASCADE");
    t.bigInteger("user_id").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.enum("status", ["pending", "confirmed", "cancelled"]).notNullable().defaultTo("pending");
    t.string("participant_role", 255).nullable();
    t.dateTime("agreed_responsibility_at", { precision: 3 }).nullable();
    t.specificType("created_at", "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");
    t.specificType(
      "updated_at",
      "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
    );
    t.unique(["event_id", "user_id"], { indexName: "uq_registration_event_user" });
    t.index(["user_id"], "ix_registrations_user");
    t.index(["event_id", "status"], "ix_registrations_event_status");
  });

  await knex("event_types").insert([
    { code: "limpeza", label: "Limpeza", sort_order: 1 },
    { code: "educacao", label: "Educação", sort_order: 2 },
    { code: "culinaria", label: "Culinária", sort_order: 3 },
    { code: "esportes", label: "Esportes", sort_order: 4 },
    { code: "venda_marketing", label: "Venda e/ou marketing", sort_order: 5 },
    { code: "saude_bem_estar", label: "Saúde e bem-estar", sort_order: 6 },
    { code: "trabalho_administrativo", label: "Trabalho administrativo", sort_order: 7 },
    { code: "logistica_operacao", label: "Logística e/ou operação", sort_order: 8 },
    { code: "reflorestamento_plantio", label: "Reflorestamento/plantio", sort_order: 9 },
    { code: "bem_estar_animal", label: "Bem-estar animal", sort_order: 10 },
    { code: "monitoria", label: "Monitoria", sort_order: 11 },
    { code: "arrecadacao", label: "Arrecadação", sort_order: 12 },
    { code: "outro", label: "Outro", sort_order: 13 },
  ]);

  await knex("requirement_options").insert([
    { code: "age_18", label: "18 anos" },
    { code: "own_vehicle", label: "Veículo próprio" },
    { code: "own_device", label: "Aparelho próprio" },
    { code: "physical_effort", label: "Esforço físico" },
  ]);

  await knex.raw("SET FOREIGN_KEY_CHECKS = 1");
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw("SET FOREIGN_KEY_CHECKS = 0");
  await knex.schema.dropTableIfExists("event_registrations");
  await knex.schema.dropTableIfExists("event_requirements");
  await knex.schema.dropTableIfExists("event_event_types");
  await knex.schema.dropTableIfExists("events");
  await knex.schema.dropTableIfExists("refresh_tokens");
  await knex.schema.dropTableIfExists("password_reset_tokens");
  await knex.schema.dropTableIfExists("users");
  await knex.schema.dropTableIfExists("requirement_options");
  await knex.schema.dropTableIfExists("event_types");
  await knex.raw("SET FOREIGN_KEY_CHECKS = 1");
};
