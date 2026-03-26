/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv").config();

const connection = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "amparian",
  charset: "utf8mb4",
  multipleStatements: true,
};

/** @type {import('knex').Knex.Config} */
module.exports = {
  client: "mysql2",
  connection,
  migrations: { directory: "./migrations", extension: "js" },
  pool: { min: 0, max: 10 },
};
