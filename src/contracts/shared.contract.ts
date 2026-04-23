import { type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../docs/zod-openapi";
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from "../utils/auth-cookies";

const errorItemSchema = z.object({
  code: z.string().openapi({ example: "VALIDATION_ERROR" }),
  message: z.string().openapi({ example: "Dados invalidos" }),
  details: z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .nullable()
    .openapi({ example: null }),
});

const lookupOptionBoundarySchema = z.object({
  code: z.string().openapi({ example: "educacao" }),
  label: z.string().openapi({ example: "Educacao" }),
});

export const userBoundarySchema = z.object({
  id: z.number().int().openapi({ example: 7 }),
  email: z.email().openapi({ example: "ana@amparian.com" }),
  name: z.string().min(1).openapi({ example: "Ana Souza" }),
  phone: z.string().nullable().openapi({ example: "+55 11 99999-9999" }),
  city: z.string().nullable().openapi({ example: "Sao Paulo" }),
  state: z.string().length(2).nullable().openapi({ example: "SP" }),
  bio: z.string().nullable().openapi({ example: "Atuante em acoes sociais." }),
  plan: z.enum(["basic", "pro"]).openapi({ example: "basic" }),
  publicOrganizationName: z.string().nullable().openapi({ example: "Instituto Vida" }),
  avatarUrl: z.url().nullable().openapi({ example: "https://cdn.amparian.com/avatar/7.png" }),
});

const paginationMetaBoundarySchema = z.object({
  page: z.number().int().openapi({ example: 1 }),
  limit: z.number().int().openapi({ example: 20 }),
  total: z.number().int().openapi({ example: 57 }),
});

const healthBoundarySchema = z.object({
  status: z.string().openapi({ example: "ok" }),
  timestamp: z.string().datetime().openapi({ example: "2026-04-22T20:30:00.000Z" }),
});

const lookupsBoundarySchema = z.object({
  eventTypes: z.array(lookupOptionBoundarySchema),
  requirementOptions: z.array(lookupOptionBoundarySchema),
});

export function registerSharedBoundaryComponents(registry: OpenAPIRegistry) {
  const errorEnvelopeSchema = registry.register(
    "ErrorEnvelope",
    z.object({
      error: errorItemSchema,
    }),
  );
  const userSchema = registry.register("User", userBoundarySchema);
  const lookupOptionSchema = registry.register("LookupOption", lookupOptionBoundarySchema);
  const paginationMetaSchema = registry.register("PaginationMeta", paginationMetaBoundarySchema);
  const healthSchema = registry.register("HealthResponse", healthBoundarySchema);
  const lookupsSchema = registry.register("LookupsResponse", lookupsBoundarySchema);

  const eventIdParam = registry.registerParameter(
    "EventId",
    z.coerce.number().int().positive().openapi({
      param: {
        name: "eventId",
        in: "path",
        description: "ID numerico do evento.",
        required: true,
      },
      example: 42,
    }),
  );
  const registrationIdParam = registry.registerParameter(
    "RegistrationId",
    z.coerce.number().int().positive().openapi({
      param: {
        name: "registrationId",
        in: "path",
        description: "ID numerico da inscricao.",
        required: true,
      },
      example: 15,
    }),
  );
  const pageQueryParam = registry.registerParameter(
    "Page",
    z.coerce.number().int().min(1).default(1).openapi({
      param: {
        name: "page",
        in: "query",
        required: false,
      },
      example: 1,
    }),
  );
  const limitQueryParam = registry.registerParameter(
    "Limit",
    z.coerce.number().int().min(1).max(100).default(20).openapi({
      param: {
        name: "limit",
        in: "query",
        required: false,
      },
      example: 20,
    }),
  );

  const cookieAuth = registry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: ACCESS_COOKIE_NAME,
    description:
      "Cookie HTTP-only principal da sessao. O refresh usa o cookie "
      + `${REFRESH_COOKIE_NAME} nos fluxos de autenticacao.`,
  });

  registry.registerPath({
    method: "get",
    path: "/health",
    tags: ["health"],
    summary: "Verifica se a API esta operacional.",
    security: [],
    responses: {
      "200": {
        description: "API operacional.",
        content: {
          "application/json": {
            schema: healthSchema,
          },
        },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/lookups",
    tags: ["lookups"],
    summary: "Lista tipos de evento e opcoes de requisitos.",
    security: [],
    responses: {
      "200": {
        description: "Lookups carregados.",
        content: {
          "application/json": {
            schema: lookupsSchema,
          },
        },
      },
    },
  });

  return {
    cookieAuth,
    cookieAuthSecurity: { cookieAuth: [] as string[] },
    errorEnvelopeSchema,
    eventIdParam,
    healthSchema,
    limitQueryParam,
    lookupOptionSchema,
    lookupsSchema,
    pageQueryParam,
    paginationMetaSchema,
    registrationIdParam,
    userSchema,
  };
}

export type SharedBoundaryComponents = ReturnType<typeof registerSharedBoundaryComponents>;
