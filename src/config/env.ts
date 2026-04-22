import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.string().default("development"),
  CORS_ORIGIN: z.string().optional(),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(5),
  AUTH_RATE_LIMIT_REFRESH_MAX: z.coerce.number().int().positive().default(15),
  AUTH_RATE_LIMIT_FORGOT_PASSWORD_MAX: z.coerce.number().int().positive().default(5),
  AUTH_RATE_LIMIT_RESET_PASSWORD_MAX: z.coerce.number().int().positive().default(5),
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().default("amparian"),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
