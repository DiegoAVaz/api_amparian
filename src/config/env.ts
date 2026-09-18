import dotenv from "dotenv";
import ms from "ms";
import { z } from "zod";

dotenv.config();

const DEFAULT_MAIL_FROM = "Amparian <no-reply@amparian.local>";

const PASSWORD_RESET_MIN_MS = 5 * 60 * 1000;
const PASSWORD_RESET_MAX_MS = 24 * 60 * 60 * 1000;

function parseDurationMs(value: string): number | null {
  let parsed: number | undefined;
  try {
    // `ms` lança, em vez de retornar undefined, para string vazia.
    parsed = (ms as (expr: string) => number | undefined)(value);
  } catch {
    return null;
  }
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const passwordResetDurationSchema = z.string().refine(
  (value) => {
    const parsed = parseDurationMs(value);
    return (
      parsed !== null &&
      parsed >= PASSWORD_RESET_MIN_MS &&
      parsed <= PASSWORD_RESET_MAX_MS
    );
  },
  {
    error:
      'PASSWORD_RESET_EXPIRES_IN deve ser uma duração entre "5m" e "24h", como "1h" ou "30m"',
  },
);

const schema = z
  .object({
    PORT: z.coerce.number().default(3001),
    NODE_ENV: z
      .enum(["development", "homolog", "production"])
      .default("development"),
    CORS_ORIGIN: z.string().optional(),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
    AUTH_RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(5),
    AUTH_RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().positive().default(5),
    AUTH_RATE_LIMIT_REFRESH_MAX: z.coerce.number().int().positive().default(15),
    AUTH_RATE_LIMIT_FORGOT_PASSWORD_MAX: z.coerce
      .number()
      .int()
      .positive()
      .default(5),
    AUTH_RATE_LIMIT_RESET_PASSWORD_MAX: z.coerce
      .number()
      .int()
      .positive()
      .default(5),
    DB_HOST: z.string().default("127.0.0.1"),
    DB_PORT: z.coerce.number().default(3306),
    DB_USER: z.string().default("root"),
    DB_PASSWORD: z.string().default(""),
    DB_NAME: z.string().default("amparian"),
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
    APP_WEB_URL: z
      .url({
        protocol: /^https?$/,
        error: "APP_WEB_URL deve ser uma URL http ou https válida",
      })
      // A barra final duplicaria a barra do path ao montar o link do e-mail.
      .transform((url) => url.replace(/\/+$/, ""))
      .default("http://localhost:3000"),
    // `prefault` em vez de `default`: valida também o valor padrão, para um
    // erro de digitação aqui não passar despercebido.
    PASSWORD_RESET_EXPIRES_IN: passwordResetDurationSchema.prefault("1h"),
    MAIL_DRIVER: z.enum(["console", "smtp"]).default("console"),
    MAIL_HOST: z.string().optional(),
    MAIL_PORT: z.coerce.number().int().positive().max(65535).default(587),
    MAIL_USER: z.string().optional(),
    MAIL_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default(DEFAULT_MAIL_FROM),
    AZURE_STORAGE_CONNECTION_STRING: z.preprocess(
      emptyToUndefined,
      z
        .string({
          error:
            "AZURE_STORAGE_CONNECTION_STRING é obrigatório em todo ambiente — copie o valor inteiro no portal Azure, na storage account, em Access keys",
        })
        .refine(
          (value) => {
            const temEndpoint =
              value.includes("BlobEndpoint=") ||
              (value.includes("DefaultEndpointsProtocol=") &&
                value.includes("AccountName="));
            const temCredencial =
              value.includes("AccountKey=") ||
              value.includes("SharedAccessSignature=");
            return temEndpoint && temCredencial;
          },
          {
            error:
              "AZURE_STORAGE_CONNECTION_STRING não parece uma connection string do Azure — copie o valor inteiro em Access keys, não apenas a chave",
          },
        ),
    ),
    AZURE_STORAGE_CONTAINER: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .min(3, {
          error: "AZURE_STORAGE_CONTAINER deve ter no mínimo 3 caracteres",
        })
        .max(63, {
          error: "AZURE_STORAGE_CONTAINER deve ter no máximo 63 caracteres",
        })
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
          error:
            "AZURE_STORAGE_CONTAINER deve usar apenas minúsculas, números e hífen, começar e terminar em letra ou número, e não pode ter hífens consecutivos",
        })
        .default("amparian"),
    ),
    STORAGE_PUBLIC_BASE_URL: z.preprocess(
      emptyToUndefined,
      z
        .url({ error: "STORAGE_PUBLIC_BASE_URL deve ser uma URL válida" })
        .transform((url) => url.replace(/\/+$/, ""))
        .optional(),
    ),
    UPLOAD_MAX_BYTES: z.preprocess(
      emptyToUndefined,
      z.coerce
        .number()
        .int()
        .min(100_000, {
          error:
            "UPLOAD_MAX_BYTES precisa ser de pelo menos 100000: abaixo disso nenhuma imagem de capa ou avatar real seria aceita",
        })
        .max(4_300_000, {
          error:
            "UPLOAD_MAX_BYTES é o tamanho máximo do arquivo e não pode passar de 4300000: o corpo da requisição multipart soma boundary e cabeçalhos por cima, e precisa caber no teto de 4,5 MB da função serverless na Vercel",
        })
        .default(4_000_000),
    ),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "development") return;

    if (
      !value.CORS_ORIGIN?.split(",").some((origin) => origin.trim().length > 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "CORS_ORIGIN é obrigatório fora do ambiente de desenvolvimento",
        path: ["CORS_ORIGIN"],
      });
    }

    // É a base do link de recuperação: o token viaja na query string, então
    // http em claro o expõe em log de proxy, cache e histórico do navegador.
    if (!value.APP_WEB_URL.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        message:
          "APP_WEB_URL precisa usar https fora do ambiente de desenvolvimento — é a base do link de recuperação de senha",
        path: ["APP_WEB_URL"],
      });
    }

    if (value.MAIL_DRIVER !== "smtp") {
      ctx.addIssue({
        code: "custom",
        message:
          'MAIL_DRIVER deve ser "smtp" fora do ambiente de desenvolvimento',
        path: ["MAIL_DRIVER"],
      });
    }

    for (const field of [
      "MAIL_HOST",
      "MAIL_USER",
      "MAIL_PASSWORD",
      "MAIL_FROM",
    ] as const) {
      if (!value[field]?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: `${field} é obrigatório fora do ambiente de desenvolvimento`,
          path: [field],
        });
      }
    }

    if (value.MAIL_FROM === DEFAULT_MAIL_FROM) {
      ctx.addIssue({
        code: "custom",
        message:
          "MAIL_FROM é obrigatório fora do ambiente de desenvolvimento e precisa ser um remetente verificado no provedor SMTP",
        path: ["MAIL_FROM"],
      });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Configuração validada, em singleton preguiçoso.
 *
 * É uma função, e não uma constante exportada, de propósito. Validar no
 * import obrigaria todo módulo que importasse `env` — direta ou
 * transitivamente — a ter ambiente válido só para ser carregado, inclusive um
 * teste de unidade que não lê configuração nenhuma. Sendo função, o parse só
 * acontece quando alguém realmente precisa do valor, uma única vez.
 *
 * O efeito colateral desejado é que cada `getEnv()` no código marca, à vista,
 * um módulo que depende de configuração ambiente.
 *
 * Memorizado pelo tempo de vida do processo, sem hook de reset: um teste que
 * precise de configuração diferente deve recebê-la por injeção, como
 * `PasswordResetConfig`, e não mutar `process.env`.
 */
export function getEnv(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const detalhes = parsed.error.issues
        .map(
          (issue) =>
            `  - ${issue.path.join(".") || "(raiz)"}: ${issue.message}`,
        )
        .join("\n");
      throw new Error(`Configuração de ambiente inválida:\n${detalhes}`);
    }
    cached = parsed.data;
  }
  return cached;
}
