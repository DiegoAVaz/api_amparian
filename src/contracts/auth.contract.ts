import { type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../docs/zod-openapi";
import { optionalRegisterPhoneSchema } from "./phone.contract";
import type { SharedBoundaryComponents } from "./shared.contract";

const strongPasswordMessageError =
  "A senha deve conter pelo menos 8 caracteres, incluindo letras maiúsculas, minúsculas, números e caracteres especiais.";

export const strongPasswordBoundarySchema = z
  .string()
  .min(8, { error: strongPasswordMessageError })
  .max(72, { error: "A senha deve ter no máximo 72 caracteres" })
  .regex(/[A-Z]/, { error: strongPasswordMessageError })
  .regex(/[a-z]/, { error: strongPasswordMessageError })
  .regex(/\d/, { error: strongPasswordMessageError })
  .regex(/[^\w\s]/, { error: strongPasswordMessageError })
  .openapi({
    description:
      "Mínimo de 8 caracteres, com letra maiúscula, minúscula, número e caractere especial.",
  });

export const emailBoundarySchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z
    .email({ error: "E-mail inválido" })
    .max(255, { error: "O e-mail deve ter no máximo 255 caracteres" }),
);

const nameBoundarySchema = z
  .string()
  .trim()
  .min(2, { error: "O nome deve ter pelo menos 2 caracteres" })
  .max(255, { error: "O nome deve ter no máximo 255 caracteres" });

const requiredTokenBoundarySchema = z
  .string()
  .trim()
  .min(1, { error: "O token é obrigatório" })
  .max(512, { error: "O token deve ter no máximo 512 caracteres" });

const optionalTokenBoundarySchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z
    .string()
    .max(512, { error: "O token deve ter no máximo 512 caracteres" })
    .optional(),
);

export const registerBodySchema = z.object({
  email: emailBoundarySchema,
  password: strongPasswordBoundarySchema,
  name: nameBoundarySchema,
  phone: optionalRegisterPhoneSchema,
});

export const loginBodySchema = z.object({
  email: emailBoundarySchema,
  password: z
    .string()
    .min(1, { error: "A senha é obrigatória" })
    .max(72, { error: "A senha deve ter no máximo 72 caracteres" }),
});

export const refreshBodySchema = z.object({
  refreshToken: requiredTokenBoundarySchema,
});

export const logoutBodySchema = z.object({
  refreshToken: optionalTokenBoundarySchema,
});

export const forgotPasswordBodySchema = z.object({
  email: emailBoundarySchema,
});

export const resetPasswordBodySchema = z.object({
  token: requiredTokenBoundarySchema,
  newPassword: strongPasswordBoundarySchema,
});

export function registerAuthBoundaryContract(
  registry: OpenAPIRegistry,
  shared: SharedBoundaryComponents,
) {
  const authResponseSchema = registry.register(
    "AuthResponse",
    z.object({
      accessToken: z.string().min(1).openapi({
        description: "JWT de acesso usado no header Authorization Bearer.",
      }),
      refreshToken: z.string().min(1).openapi({
        description: "Token de renovação armazenado pelo cliente.",
      }),
      user: shared.userSchema,
      expiresIn: z.number().int().openapi({
        description: "Tempo de expiração do access token, em segundos.",
      }),
    }),
  );
  const refreshResponseSchema = registry.register(
    "RefreshResponse",
    z.object({
      accessToken: z.string().min(1).openapi({
        description: "Novo JWT de acesso usado no header Authorization Bearer.",
      }),
      refreshToken: z.string().min(1).openapi({
        description: "Novo token de renovação armazenado pelo cliente.",
      }),
      expiresIn: z.number().int().openapi({
        description: "Tempo de expiração do access token, em segundos.",
      }),
    }),
  );
  const forgotPasswordResponseSchema = registry.register(
    "ForgotPasswordResponse",
    z.object({
      message: z.string(),
    }),
  );

  registry.registerPath({
    method: "post",
    path: "/auth/register",
    tags: ["auth"],
    summary: "Cria uma conta e retorna os tokens da sessão.",
    security: [],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: registerBodySchema,
          },
        },
      },
    },
    responses: {
      "201": {
        description: "Conta criada com sucesso.",
        content: {
          "application/json": {
            schema: authResponseSchema,
          },
        },
      },
      "400": {
        description: "Falha de validação do payload.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "409": {
        description: "Conflito de cadastro.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/auth/login",
    tags: ["auth"],
    summary: "Autentica usuário e retorna os tokens da sessão.",
    security: [],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: loginBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Login efetuado com sucesso.",
        content: {
          "application/json": {
            schema: authResponseSchema,
          },
        },
      },
      "400": {
        description: "Falha de validação do payload.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Credenciais inválidas.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "429": {
        description: "Limite de tentativas excedido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/auth/refresh",
    tags: ["auth"],
    summary: "Renova a sessão usando o refresh token enviado no corpo.",
    security: [],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: refreshBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Sessão renovada e tokens atualizados.",
        content: {
          "application/json": {
            schema: refreshResponseSchema,
          },
        },
      },
      "400": {
        description: "Falha de validação do payload.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Refresh token inválido ou expirado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "429": {
        description: "Limite de tentativas excedido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/auth/logout",
    tags: ["auth"],
    summary: "Encerra a sessão revogando o refresh token informado.",
    security: [],
    request: {
      body: {
        required: false,
        content: {
          "application/json": {
            schema: logoutBodySchema,
          },
        },
      },
    },
    responses: {
      "204": {
        description: "Sessão encerrada.",
      },
      "400": {
        description: "Falha de validação do payload.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/auth/forgot-password",
    tags: ["auth"],
    summary: "Solicita a recuperação de senha.",
    security: [],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: forgotPasswordBodySchema,
          },
        },
      },
    },
    responses: {
      "202": {
        description: "Solicitação recebida.",
        content: {
          "application/json": {
            schema: forgotPasswordResponseSchema,
          },
        },
      },
      "400": {
        description: "Falha de validação do payload.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "429": {
        description: "Limite de tentativas excedido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/auth/reset-password",
    tags: ["auth"],
    summary:
      "Redefine a senha usando o token recebido no fluxo de recuperação.",
    security: [],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: resetPasswordBodySchema,
          },
        },
      },
    },
    responses: {
      "204": {
        description: "Senha redefinida com sucesso.",
      },
      "400": {
        description: "Falha de validação do payload.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Token de recuperação inválido ou expirado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "429": {
        description: "Limite de tentativas excedido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });
}

