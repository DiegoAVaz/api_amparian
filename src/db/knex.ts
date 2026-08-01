import knex, { type Knex } from "knex";
import dotenv from "dotenv";

dotenv.config();

export const db: Knex = knex({
  client: "mysql2",
  connection: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "amparian",
    charset: "utf8mb4",
    timezone: "Z",
  },
  pool: {
    min: 0,
    max: 10,
    afterCreate: (
      conn: { query: (sql: string, cb: (err?: unknown) => void) => void },
      done: (err: unknown, conn: unknown) => void,
    ) => {
      conn.query("SET time_zone = '+00:00'", (err?: unknown) =>
        done(err, conn),
      );
    },
  },
});
