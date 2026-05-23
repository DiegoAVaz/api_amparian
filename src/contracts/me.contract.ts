import { type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../docs/zod-openapi";
import type { SharedBoundaryComponents } from "./shared.contract";

const httpUrlSchema = z
  .string()
  .trim()
  .pipe(z.url({ error: "URL inválida" }))
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    {
      error: "A URL deve começar com http:// ou https://",
    },
  );

export const meProfilePatchBodySchema = z.object({
  name: z.string().min(1).optional(),
  phone: z
    .string()
    .nullable()
    .optional(),
  city: z.string().nullable().optional(),
  state: z.string().length(2).nullable().optional(),
  bio: z
    .string()
    .nullable()
    .optional(),
  publicOrganizationName: z
    .string()
    .nullable()
    .optional(),
  avatarUrl: httpUrlSchema
    .nullable()
    .optional(),
});

export const meRegistrationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const meAgendaQuerySchema = z.object({
  year: z.coerce
    .number()
    .int()
    .min(2000)
    .max(2100)
    .openapi({
      param: { name: "year", in: "query", required: true },
    }),
  month: z.coerce
    .number()
    .int()
    .min(1)
    .max(12)
    .openapi({
      param: { name: "month", in: "query", required: true },
    }),
});

export const meEventsFilterQuerySchema = z.object({
  filter: z
    .enum(["upcoming", "past", "ongoing"])
    .optional()
    .openapi({
      param: { name: "filter", in: "query", required: false },
    }),
});

export const createEventBodySchema = z
  .object({
    title: z.string().min(1),
    summary: z
      .string()
      .min(1),
    description: z
      .string()
      .nullable()
      .optional(),
    rulesTerms: z
      .string()
      .nullable()
      .optional(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable().optional(),
    locationName: z
      .string()
      .nullable()
      .optional(),
    isRemote: z.boolean(),
    capacity: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional(),
    highlightSkill: z
      .string()
      .nullable()
      .optional(),
    typeCodes: z
      .array(z.string())
      .min(1),
    requirementCodes: z
      .array(z.string()),
    publish: z.boolean(),
    coverImageUrl: httpUrlSchema
      .nullable()
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.endsAt) return;
    const startsAt = new Date(value.startsAt).getTime();
    const endsAt = new Date(value.endsAt).getTime();
    if (endsAt <= startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endsAt deve ser maior que startsAt",
        path: ["endsAt"],
      });
    }
  });

export const patchEventBodySchema = z
  .object({
    title: z
      .string()
      .min(1)
      .optional(),
    summary: z
      .string()
      .min(1)
      .optional(),
    description: z
      .string()
      .nullable()
      .optional(),
    rulesTerms: z
      .string()
      .nullable()
      .optional(),
    startsAt: z
      .iso
      .datetime()
      .optional(),
    endsAt: z
      .iso
      .datetime()
      .nullable()
      .optional(),
    locationName: z
      .string()
      .nullable()
      .optional(),
    isRemote: z.boolean().optional(),
    capacity: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional(),
    highlightSkill: z
      .string()
      .nullable()
      .optional(),
    coverImageUrl: httpUrlSchema
      .nullable()
      .optional(),
    typeCodes: z
      .array(z.string())
      .optional(),
    requirementCodes: z
      .array(z.string())
      .optional(),
    publish: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.startsAt === undefined ||
      value.endsAt === undefined ||
      value.endsAt === null
    )
      return;
    const startsAt = new Date(value.startsAt).getTime();
    const endsAt = new Date(value.endsAt).getTime();
    if (endsAt <= startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endsAt deve ser maior que startsAt",
        path: ["endsAt"],
      });
    }
  });

export const updateOrganizerRegistrationBodySchema = z.object({
  status: z
    .enum(["pending", "confirmed", "cancelled"]),
});

export const meEventIdParamsSchema = z.object({
  eventId: z.coerce.number().int().positive(),
});

export const meRegistrationIdParamsSchema = z.object({
  registrationId: z.coerce.number().int().positive(),
});

export const meEventRegistrationParamsSchema = z.object({
  eventId: z.coerce.number().int().positive(),
  registrationId: z.coerce.number().int().positive(),
});

export function registerMeBoundaryContract(
  registry: OpenAPIRegistry,
  shared: SharedBoundaryComponents,
) {
  const profileStatsSchema = registry.register(
    "ProfileStatsResponse",
    z.object({
      hoursDonated: z.number().int(),
      causesSupported: z.number().int(),
      eventsAttended: z.number().int(),
      eventsCreated: z.number().int(),
    }),
  );

  const myRegistrationItemSchema = registry.register(
    "MyRegistrationItem",
    z.object({
      id: z.number().int(),
      status: z
        .enum(["pending", "confirmed", "cancelled"]),
      event: z.object({
        id: z.number().int(),
        title: z.string(),
        org: z.string(),
        startsAt: z.iso.datetime(),
      }),
    }),
  );

  const myRegistrationsSchema = registry.register(
    "MyRegistrationsResponse",
    z.object({
      data: z.array(myRegistrationItemSchema),
      meta: shared.paginationMetaSchema,
    }),
  );

  const agendaSchema = registry.register(
    "AgendaResponse",
    z.object({
      data: z.array(
        z.object({
          eventId: z.number().int(),
          title: z.string(),
          org: z.string(),
          startsAt: z.iso.datetime(),
          dayLabel: z.string(),
        }),
      ),
    }),
  );

  const organizerListEventsSchema = registry.register(
    "OrganizerListEventsResponse",
    z.object({
      data: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          filter: z
            .enum(["upcoming", "past", "ongoing"]),
          statusLabel: z.string(),
          description: z.string(),
          imageClassName: z.string(),
          startsAt: z.iso.datetime(),
          status: z
            .enum(["draft", "published", "cancelled"]),
        }),
      ),
    }),
  );

  const organizerEventSchema = registry.register(
    "OrganizerEvent",
    z.object({
      id: z.number().int(),
      organizer_id: z.number().int(),
      title: z.string(),
      summary: z.string(),
      description: z
        .string()
        .nullable(),
      rules_terms: z
        .string()
        .nullable(),
      starts_at: z.iso.datetime(),
      ends_at: z.iso.datetime().nullable(),
      location_name: z
        .string()
        .nullable(),
      is_remote: z.boolean(),
      capacity: z.number().int().nullable(),
      cover_image_url: z.url().nullable(),
      highlight_skill: z
        .string()
        .nullable(),
      status: z
        .enum(["draft", "published", "cancelled"]),
      created_at: z.iso.datetime().optional(),
      updated_at: z.iso.datetime().optional(),
      types: z.array(shared.lookupOptionSchema),
      requirements: z.array(shared.lookupOptionSchema),
      computedStatus: z
        .enum([
          "draft",
          "published",
          "cancelled",
          "upcoming",
          "ongoing",
          "past",
        ]),
    }),
  );

  const organizerRegistrationsSchema = registry.register(
    "OrganizerRegistrationsResponse",
    z.object({
      data: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          role: z.string(),
          email: z.email(),
          phone: z.string(),
          cityUf: z.string(),
          registrationDate: z.iso.datetime(),
          status: z
            .enum(["pending", "confirmed", "cancelled"]),
        }),
      ),
    }),
  );

  const updateRegistrationStatusSchema = registry.register(
    "UpdateRegistrationStatusResponse",
    z.object({
      id: z.number().int(),
      status: z
        .enum(["pending", "confirmed", "cancelled"]),
    }),
  );

  registry.registerPath({
    method: "get",
    path: "/me",
    tags: ["me"],
    summary: "Retorna o perfil do usuário autenticado.",
    security: [shared.bearerAuthSecurity],
    responses: {
      "200": {
        description: "Perfil carregado.",
        content: { "application/json": { schema: shared.userSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Usuário não encontrado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/me",
    tags: ["me"],
    summary: "Atualiza parcialmente o perfil do usuário autenticado.",
    security: [shared.bearerAuthSecurity],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: meProfilePatchBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Perfil atualizado.",
        content: { "application/json": { schema: shared.userSchema } },
      },
      "400": {
        description: "Payload inválido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Usuário não encontrado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/me/stats",
    tags: ["me"],
    summary: "Retorna os indicadores do usuário autenticado.",
    security: [shared.bearerAuthSecurity],
    responses: {
      "200": {
        description: "Estatísticas carregadas.",
        content: { "application/json": { schema: profileStatsSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Usuário não encontrado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/me/registrations",
    tags: ["me"],
    summary: "Lista as inscrições do usuário autenticado.",
    security: [shared.bearerAuthSecurity],
    request: {
      query: meRegistrationsQuerySchema,
    },
    responses: {
      "200": {
        description: "Inscrições carregadas.",
        content: { "application/json": { schema: myRegistrationsSchema } },
      },
      "400": {
        description: "Query inválida.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/me/registrations/{registrationId}",
    tags: ["me"],
    summary: "Cancela uma inscrição do usuário autenticado.",
    security: [shared.bearerAuthSecurity],
    request: {
      params: z.object({
        registrationId: shared.registrationIdParam,
      }),
    },
    responses: {
      "204": {
        description: "Inscrição cancelada.",
      },
      "400": {
        description: "Path param inválido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Inscrição não encontrada.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/me/agenda",
    tags: ["me"],
    summary: "Retorna a agenda mensal do usuário autenticado.",
    security: [shared.bearerAuthSecurity],
    request: {
      query: meAgendaQuerySchema,
    },
    responses: {
      "200": {
        description: "Agenda carregada.",
        content: { "application/json": { schema: agendaSchema } },
      },
      "400": {
        description: "Query inválida.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/me/events",
    tags: ["me"],
    summary: "Lista eventos do organizador autenticado.",
    security: [shared.bearerAuthSecurity],
    request: {
      query: meEventsFilterQuerySchema,
    },
    responses: {
      "200": {
        description: "Eventos do organizador carregados.",
        content: { "application/json": { schema: organizerListEventsSchema } },
      },
      "400": {
        description: "Query inválida.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
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
    path: "/me/events",
    tags: ["me"],
    summary: "Cria um novo evento para o organizador autenticado.",
    security: [shared.bearerAuthSecurity],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: createEventBodySchema,
          },
        },
      },
    },
    responses: {
      "201": {
        description: "Evento criado.",
        content: { "application/json": { schema: organizerEventSchema } },
      },
      "400": {
        description: "Payload inválido ou regras de negócio não atendidas.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/me/events/{eventId}/registrations",
    tags: ["me"],
    summary: "Lista inscrições de um evento do organizador autenticado.",
    security: [shared.bearerAuthSecurity],
    request: {
      params: z.object({
        eventId: shared.eventIdParam,
      }),
    },
    responses: {
      "200": {
        description: "Inscrições do evento carregadas.",
        content: {
          "application/json": { schema: organizerRegistrationsSchema },
        },
      },
      "400": {
        description: "Path param inválido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento não encontrado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/me/events/{eventId}/registrations/{registrationId}",
    tags: ["me"],
    summary: "Atualiza o status de uma inscrição em evento do organizador.",
    security: [shared.bearerAuthSecurity],
    request: {
      params: z.object({
        eventId: shared.eventIdParam,
        registrationId: shared.registrationIdParam,
      }),
      body: {
        required: true,
        content: {
          "application/json": {
            schema: updateOrganizerRegistrationBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Status atualizado.",
        content: {
          "application/json": { schema: updateRegistrationStatusSchema },
        },
      },
      "400": {
        description: "Payload ou params inválidos.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento ou inscrição não encontrados.",
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
    path: "/me/events/{eventId}/publish",
    tags: ["me"],
    summary: "Publica um evento do organizador autenticado.",
    security: [shared.bearerAuthSecurity],
    request: {
      params: z.object({
        eventId: shared.eventIdParam,
      }),
    },
    responses: {
      "200": {
        description: "Evento publicado.",
        content: { "application/json": { schema: organizerEventSchema } },
      },
      "400": {
        description: "Path param inválido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento não encontrado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/me/events/{eventId}",
    tags: ["me"],
    summary: "Retorna os detalhes de um evento do organizador autenticado.",
    security: [shared.bearerAuthSecurity],
    request: {
      params: z.object({
        eventId: shared.eventIdParam,
      }),
    },
    responses: {
      "200": {
        description: "Evento carregado.",
        content: { "application/json": { schema: organizerEventSchema } },
      },
      "400": {
        description: "Path param inválido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento não encontrado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/me/events/{eventId}",
    tags: ["me"],
    summary: "Atualiza parcialmente um evento do organizador autenticado.",
    security: [shared.bearerAuthSecurity],
    request: {
      params: z.object({
        eventId: shared.eventIdParam,
      }),
      body: {
        required: true,
        content: {
          "application/json": {
            schema: patchEventBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Evento atualizado.",
        content: { "application/json": { schema: organizerEventSchema } },
      },
      "400": {
        description: "Payload ou path param inválidos.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento não encontrado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/me/events/{eventId}",
    tags: ["me"],
    summary: "Remove um evento do organizador autenticado.",
    security: [shared.bearerAuthSecurity],
    request: {
      params: z.object({
        eventId: shared.eventIdParam,
      }),
    },
    responses: {
      "204": {
        description: "Evento removido.",
      },
      "400": {
        description: "Path param inválido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento não encontrado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });
}
