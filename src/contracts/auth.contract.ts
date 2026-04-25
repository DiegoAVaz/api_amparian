import { type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../docs/zod-openapi";
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from "../utils/auth-cookies";
import type { SharedBoundaryComponents } from "./shared.contract";

export const strongPasswordBoundarySchema = z
  .string()
  .min(8, { error: "A senha deve ter pelo menos 8 caracteres" })
  .max(72, { error: "A senha deve ter no máximo 72 caracteres" })
  .regex(/[A-Z]/, { error: "A senha deve ter ao menos 1 letra maiúscula" })
  .regex(/[a-z]/, { error: "A senha deve ter ao menos 1 letra minúscula" })
  .regex(/\d/, { error: "A senha deve ter ao menos 1 número" })
  .regex(/[^\w\s]/, { error: "A senha deve ter ao menos 1 caractere especial" })
  .openapi({
    description:
      "Mínimo de 8 caracteres, com letra maiúscula, minúscula, número e caractere especial.",
  });

export const registerBodySchema = z.object({
  email: z.email(),
  password: strongPasswordBoundarySchema,
  name: z.string().min(1),
  phone: z.string().optional(),
});

export const loginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const refreshBodySchema = z.object({
  refreshToken: z
    .string()
    .min(1)
    .optional(),
});

export const logoutBodySchema = z.object({
  refreshToken: z
    .string()
    .optional(),
});

export const forgotPasswordBodySchema = z.object({
  email: z.email(),
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(1),
  newPassword: strongPasswordBoundarySchema,
});

export function registerAuthBoundaryContract(
  registry: OpenAPIRegistry,
  shared: SharedBoundaryComponents,
) {
  const authResponseSchema = registry.register(
    "AuthResponse",
    z.object({
      user: shared.userSchema,
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

  const setCookieHeader = {
    description: "Cookies HTTP-only usados pela sessão.",
    schema: { type: "string" as const },
  };

  registry.registerPath({
    method: "post",
    path: "/auth/register",
    tags: ["auth"],
    summary: "Cria uma conta e inicia sessão por cookies.",
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
        headers: {
          "Set-Cookie": {
            ...setCookieHeader,
            example: `${ACCESS_COOKIE_NAME}=...; Path=/; HttpOnly`,
          },
        },
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
    summary: "Autentica usuário e define cookies HTTP-only da sessão.",
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
        headers: {
          "Set-Cookie": {
            ...setCookieHeader,
            example: `${ACCESS_COOKIE_NAME}=...; Path=/; HttpOnly`,
          },
        },
        content: {
          "application/json": {
            schema: authResponseSchema,
          },
        },
      },
      "400": {
        description: "Falha de validação do payload ou credenciais inválidas.",
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
    summary: "Renova a sessão usando o refresh token do cookie ou do corpo.",
    description: `O fluxo principal usa o cookie ${REFRESH_COOKIE_NAME}. O corpo só existe como fallback técnico.`,
    security: [],
    request: {
      body: {
        required: false,
        content: {
          "application/json": {
            schema: refreshBodySchema,
          },
        },
      },
    },
    responses: {
      "204": {
        description: "Sessão renovada e cookies atualizados.",
        headers: {
          "Set-Cookie": {
            ...setCookieHeader,
            example: `${REFRESH_COOKIE_NAME}=...; Path=/; HttpOnly`,
          },
        },
      },
      "400": {
        description: "Falha de validação do payload ou refresh inválido/expirado.",
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
    summary: "Encerra a sessão e limpa os cookies de autenticação.",
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
        headers: {
          "Set-Cookie": {
            ...setCookieHeader,
            example: `${ACCESS_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly`,
          },
        },
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
        description: "Payload inválido ou token inválido.",
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
