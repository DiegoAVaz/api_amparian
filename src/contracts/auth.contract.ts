import { type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../docs/zod-openapi";
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from "../utils/auth-cookies";
import type { SharedBoundaryComponents } from "./shared.contract";

export const strongPasswordBoundarySchema = z
  .string()
  .min(8, { error: "A senha deve ter pelo menos 8 caracteres" })
  .max(72, { error: "A senha deve ter no maximo 72 caracteres" })
  .regex(/[A-Z]/, { error: "A senha deve ter ao menos 1 letra maiuscula" })
  .regex(/[a-z]/, { error: "A senha deve ter ao menos 1 letra minuscula" })
  .regex(/\d/, { error: "A senha deve ter ao menos 1 numero" })
  .regex(/[^\w\s]/, { error: "A senha deve ter ao menos 1 caractere especial" })
  .openapi({
    example: "Senha@123",
    description: "Minimo de 8 caracteres, com letra maiuscula, minuscula, numero e caractere especial.",
  });

export const registerBodySchema = z.object({
  email: z.email().openapi({ example: "ana@amparian.com" }),
  password: strongPasswordBoundarySchema,
  name: z.string().min(1).openapi({ example: "Ana Souza" }),
  phone: z.string().optional().openapi({ example: "+55 11 99999-9999" }),
});

export const loginBodySchema = z.object({
  email: z.email().openapi({ example: "ana@amparian.com" }),
  password: z.string().min(1).openapi({ example: "Senha@123" }),
});

export const refreshBodySchema = z.object({
  refreshToken: z
    .string()
    .min(1)
    .optional()
    .openapi({ example: "fallback-refresh-token" }),
});

export const logoutBodySchema = z.object({
  refreshToken: z.string().optional().openapi({ example: "fallback-refresh-token" }),
});

export const forgotPasswordBodySchema = z.object({
  email: z.email().openapi({ example: "ana@amparian.com" }),
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(1).openapi({ example: "reset-token" }),
  newPassword: strongPasswordBoundarySchema.openapi({ example: "NovaSenha@123" }),
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
        example: 900,
        description: "Tempo de expiracao do access token, em segundos.",
      }),
    }),
  );
  const forgotPasswordResponseSchema = registry.register(
    "ForgotPasswordResponse",
    z.object({
      message: z.string().openapi({ example: "Se o e-mail existir, enviaremos instrucoes." }),
    }),
  );

  const setCookieHeader = {
    description: "Cookies HTTP-only usados pela sessao.",
    schema: { type: "string" as const },
  };

  registry.registerPath({
    method: "post",
    path: "/auth/register",
    tags: ["auth"],
    summary: "Cria uma conta e inicia sessao por cookies.",
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
        description: "Falha de validacao do payload.",
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
    summary: "Autentica usuario e define cookies HTTP-only da sessao.",
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
        description: "Falha de validacao do payload.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Credenciais invalidas.",
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
    summary: "Renova a sessao usando o refresh token do cookie ou do corpo.",
    description: `O fluxo principal usa o cookie ${REFRESH_COOKIE_NAME}. O corpo so existe como fallback tecnico.`,
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
        description: "Sessao renovada e cookies atualizados.",
        headers: {
          "Set-Cookie": {
            ...setCookieHeader,
            example: `${REFRESH_COOKIE_NAME}=...; Path=/; HttpOnly`,
          },
        },
      },
      "400": {
        description: "Falha de validacao do payload.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Refresh invalido ou expirado.",
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
    summary: "Encerra a sessao e limpa os cookies de autenticacao.",
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
        description: "Sessao encerrada.",
        headers: {
          "Set-Cookie": {
            ...setCookieHeader,
            example: `${ACCESS_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly`,
          },
        },
      },
      "400": {
        description: "Falha de validacao do payload.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/auth/forgot-password",
    tags: ["auth"],
    summary: "Solicita a recuperacao de senha.",
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
        description: "Solicitacao recebida.",
        content: {
          "application/json": {
            schema: forgotPasswordResponseSchema,
          },
        },
      },
      "400": {
        description: "Falha de validacao do payload.",
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
    summary: "Redefine a senha usando o token recebido no fluxo de recuperacao.",
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
        description: "Payload invalido ou token invalido.",
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
