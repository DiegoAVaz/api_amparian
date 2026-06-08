import { type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../docs/zod-openapi";

const errorItemSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .nullable(),
});

const lookupOptionBoundarySchema = z.object({
  code: z.string(),
  label: z.string(),
});

export const userBoundarySchema = z.object({
  id: z.number().int(),
  email: z.email(),
  name: z.string().min(1),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().length(2).nullable(),
  bio: z.string().nullable(),
  plan: z.enum(["basic", "pro"]),
  publicOrganizationName: z.string().nullable(),
  avatarUrl: z.url().nullable(),
});

const paginationMetaBoundarySchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
});

const healthBoundarySchema = z.object({
  status: z.string(),
  timestamp: z.iso.datetime(),
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
        description: "ID numérico do evento.",
        required: true,
      },
    }),
  );
  const registrationIdParam = registry.registerParameter(
    "RegistrationId",
    z.coerce.number().int().positive().openapi({
      param: {
        name: "registrationId",
        in: "path",
        description: "ID numérico da inscrição.",
        required: true,
      },
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
    }),
  );

  const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "JWT de acesso enviado no header Authorization como Bearer token.",
  });

  registry.registerPath({
    method: "get",
    path: "/health",
    tags: ["health"],
    summary: "Verifica se a API está operacional.",
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
    summary: "Lista tipos de evento e opções de requisitos.",
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
    bearerAuth,
    bearerAuthSecurity: { bearerAuth: [] as string[] },
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
