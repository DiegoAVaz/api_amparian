import { type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../docs/zod-openapi";
import type { SharedBoundaryComponents } from "./shared.contract";

const httpUrlSchema = z
  .string()
  .trim()
  .pipe(z.url({ error: "URL invalida" }))
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    {
      error: "A URL deve comecar com http:// ou https://",
    },
  );

export const meProfilePatchBodySchema = z.object({
  name: z.string().min(1).optional().openapi({ example: "Ana Souza" }),
  phone: z
    .string()
    .nullable()
    .optional()
    .openapi({ example: "+55 11 99999-9999" }),
  city: z.string().nullable().optional().openapi({ example: "Sao Paulo" }),
  state: z.string().length(2).nullable().optional().openapi({ example: "SP" }),
  bio: z
    .string()
    .nullable()
    .optional()
    .openapi({ example: "Atuante em acoes sociais." }),
  publicOrganizationName: z
    .string()
    .nullable()
    .optional()
    .openapi({ example: "Instituto Vida" }),
  avatarUrl: httpUrlSchema
    .nullable()
    .optional()
    .openapi({ example: "https://cdn.amparian.com/avatar/7.png" }),
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
      example: 2026,
    }),
  month: z.coerce
    .number()
    .int()
    .min(1)
    .max(12)
    .openapi({
      param: { name: "month", in: "query", required: true },
      example: 4,
    }),
});

export const meEventsFilterQuerySchema = z.object({
  filter: z
    .enum(["upcoming", "past", "ongoing"])
    .optional()
    .openapi({
      param: { name: "filter", in: "query", required: false },
      example: "upcoming",
    }),
});

export const createEventBodySchema = z
  .object({
    title: z.string().min(1).openapi({ example: "Mutirao de Inverno" }),
    summary: z
      .string()
      .min(1)
      .openapi({ example: "Acao solidaria para arrecadacao e distribuicao." }),
    description: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: "Traga agasalhos e itens de higiene." }),
    rulesTerms: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: "Uso obrigatorio de cracha." }),
    startsAt: z.iso.datetime().openapi({ example: "2026-05-10T13:00:00.000Z" }),
    endsAt: z.iso.datetime().nullable().optional().openapi({ example: "2026-05-10T18:00:00.000Z" }),
    locationName: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: "Centro Comunitario Bela Vista" }),
    isRemote: z.boolean().openapi({ example: false }),
    capacity: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .openapi({ example: 120 }),
    highlightSkill: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: "Organizacao de equipes" }),
    typeCodes: z
      .array(z.string())
      .min(1)
      .openapi({ example: ["educacao", "assistencia-social"] }),
    requirementCodes: z
      .array(z.string())
      .openapi({ example: ["maior-de-18", "documento-com-foto"] }),
    publish: z.boolean().openapi({ example: false }),
    coverImageUrl: httpUrlSchema
      .nullable()
      .optional()
      .openapi({ example: "https://cdn.amparian.com/events/42-cover.jpg" }),
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
      .optional()
      .openapi({ example: "Mutirao de Inverno" }),
    summary: z
      .string()
      .min(1)
      .optional()
      .openapi({ example: "Acao solidaria para arrecadacao e distribuicao." }),
    description: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: "Traga agasalhos e itens de higiene." }),
    rulesTerms: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: "Uso obrigatorio de cracha." }),
    startsAt: z
      .iso
      .datetime()
      .optional()
      .openapi({ example: "2026-05-10T13:00:00.000Z" }),
    endsAt: z
      .iso
      .datetime()
      .nullable()
      .optional()
      .openapi({ example: "2026-05-10T18:00:00.000Z" }),
    locationName: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: "Centro Comunitario Bela Vista" }),
    isRemote: z.boolean().optional().openapi({ example: false }),
    capacity: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .openapi({ example: 120 }),
    highlightSkill: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: "Organizacao de equipes" }),
    coverImageUrl: httpUrlSchema
      .nullable()
      .optional()
      .openapi({ example: "https://cdn.amparian.com/events/42-cover.jpg" }),
    typeCodes: z
      .array(z.string())
      .optional()
      .openapi({ example: ["educacao"] }),
    requirementCodes: z
      .array(z.string())
      .optional()
      .openapi({ example: ["documento-com-foto"] }),
    publish: z.boolean().optional().openapi({ example: true }),
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
    .enum(["pending", "confirmed", "cancelled"])
    .openapi({ example: "confirmed" }),
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
      hoursDonated: z.number().int().openapi({ example: 0 }),
      causesSupported: z.number().int().openapi({ example: 4 }),
      eventsAttended: z.number().int().openapi({ example: 8 }),
      eventsCreated: z.number().int().openapi({ example: 3 }),
    }),
  );

  const myRegistrationItemSchema = registry.register(
    "MyRegistrationItem",
    z.object({
      id: z.number().int().openapi({ example: 15 }),
      status: z
        .enum(["pending", "confirmed", "cancelled"])
        .openapi({ example: "confirmed" }),
      event: z.object({
        id: z.number().int().openapi({ example: 42 }),
        title: z.string().openapi({ example: "Mutirao de Inverno" }),
        org: z.string().openapi({ example: "Instituto Vida" }),
        startsAt: z.iso.datetime().openapi({ example: "2026-05-10T13:00:00.000Z" }),
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
          eventId: z.number().int().openapi({ example: 42 }),
          title: z.string().openapi({ example: "Mutirao de Inverno" }),
          org: z.string().openapi({ example: "Instituto Vida" }),
          startsAt: z.iso.datetime().openapi({ example: "2026-05-10T13:00:00.000Z" }),
          dayLabel: z.string().openapi({ example: "10 de maio" }),
        }),
      ),
    }),
  );

  const organizerListEventsSchema = registry.register(
    "OrganizerListEventsResponse",
    z.object({
      data: z.array(
        z.object({
          id: z.string().openapi({ example: "42" }),
          title: z.string().openapi({ example: "Mutirao de Inverno" }),
          filter: z
            .enum(["upcoming", "past", "ongoing"])
            .openapi({ example: "upcoming" }),
          statusLabel: z.string().openapi({ example: "Publicado" }),
          description: z
            .string()
            .openapi({
              example: "Acao solidaria para arrecadacao e distribuicao.",
            }),
          imageClassName: z
            .string()
            .openapi({ example: "from-teal-600 to-cyan-500" }),
          startsAt: z.iso.datetime().openapi({ example: "2026-05-10T13:00:00.000Z" }),
          status: z
            .enum(["draft", "published", "cancelled"])
            .openapi({ example: "published" }),
        }),
      ),
    }),
  );

  const organizerEventSchema = registry.register(
    "OrganizerEvent",
    z.object({
      id: z.number().int().openapi({ example: 42 }),
      organizer_id: z.number().int().openapi({ example: 9 }),
      title: z.string().openapi({ example: "Mutirao de Inverno" }),
      summary: z
        .string()
        .openapi({
          example: "Acao solidaria para arrecadacao e distribuicao.",
        }),
      description: z
        .string()
        .nullable()
        .openapi({ example: "Traga agasalhos e itens de higiene." }),
      rules_terms: z
        .string()
        .nullable()
        .openapi({ example: "Uso obrigatorio de cracha." }),
      starts_at: z.iso.datetime().openapi({ example: "2026-05-10T13:00:00.000Z" }),
      ends_at: z.iso.datetime().nullable().openapi({ example: "2026-05-10T18:00:00.000Z" }),
      location_name: z
        .string()
        .nullable()
        .openapi({ example: "Centro Comunitario Bela Vista" }),
      is_remote: z.boolean().openapi({ example: false }),
      capacity: z.number().int().nullable().openapi({ example: 120 }),
      cover_image_url: z.url().nullable().openapi({
        example: "https://cdn.amparian.com/events/42-cover.jpg",
      }),
      highlight_skill: z
        .string()
        .nullable()
        .openapi({ example: "Organizacao de equipes" }),
      status: z
        .enum(["draft", "published", "cancelled"])
        .openapi({ example: "draft" }),
      created_at: z.iso.datetime().optional().openapi({ example: "2026-04-20T12:00:00.000Z" }),
      updated_at: z.iso.datetime().optional().openapi({ example: "2026-04-22T20:30:00.000Z" }),
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
        ])
        .openapi({ example: "draft" }),
    }),
  );

  const organizerRegistrationsSchema = registry.register(
    "OrganizerRegistrationsResponse",
    z.object({
      data: z.array(
        z.object({
          id: z.string().openapi({ example: "15" }),
          name: z.string().openapi({ example: "Ana Souza" }),
          role: z.string().openapi({ example: "Voluntario de apoio" }),
          email: z.email().openapi({ example: "ana@amparian.com" }),
          phone: z.string().openapi({ example: "+55 11 99999-9999" }),
          cityUf: z.string().openapi({ example: "Sao Paulo / SP" }),
          registrationDate: z.iso.datetime().openapi({ example: "2026-04-22T20:30:00.000Z" }),
          status: z
            .enum(["pending", "confirmed", "cancelled"])
            .openapi({ example: "pending" }),
        }),
      ),
    }),
  );

  const updateRegistrationStatusSchema = registry.register(
    "UpdateRegistrationStatusResponse",
    z.object({
      id: z.number().int().openapi({ example: 15 }),
      status: z
        .enum(["pending", "confirmed", "cancelled"])
        .openapi({ example: "confirmed" }),
    }),
  );

  registry.registerPath({
    method: "get",
    path: "/me",
    tags: ["me"],
    summary: "Retorna o perfil do usuario autenticado.",
    security: [shared.cookieAuthSecurity],
    responses: {
      "200": {
        description: "Perfil carregado.",
        content: { "application/json": { schema: shared.userSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Usuario nao encontrado.",
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
    summary: "Atualiza parcialmente o perfil do usuario autenticado.",
    security: [shared.cookieAuthSecurity],
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
        description: "Payload invalido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Usuario nao encontrado.",
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
    summary: "Retorna os indicadores do usuario autenticado.",
    security: [shared.cookieAuthSecurity],
    responses: {
      "200": {
        description: "Estatisticas carregadas.",
        content: { "application/json": { schema: profileStatsSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Usuario nao encontrado.",
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
    summary: "Lista as inscricoes do usuario autenticado.",
    security: [shared.cookieAuthSecurity],
    request: {
      query: meRegistrationsQuerySchema,
    },
    responses: {
      "200": {
        description: "Inscricoes carregadas.",
        content: { "application/json": { schema: myRegistrationsSchema } },
      },
      "400": {
        description: "Query invalida.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
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
    summary: "Cancela uma inscricao do usuario autenticado.",
    security: [shared.cookieAuthSecurity],
    request: {
      params: z.object({
        registrationId: shared.registrationIdParam,
      }),
    },
    responses: {
      "204": {
        description: "Inscricao cancelada.",
      },
      "400": {
        description: "Path param invalido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Inscricao nao encontrada.",
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
    summary: "Retorna a agenda mensal do usuario autenticado.",
    security: [shared.cookieAuthSecurity],
    request: {
      query: meAgendaQuerySchema,
    },
    responses: {
      "200": {
        description: "Agenda carregada.",
        content: { "application/json": { schema: agendaSchema } },
      },
      "400": {
        description: "Query invalida.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
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
    security: [shared.cookieAuthSecurity],
    request: {
      query: meEventsFilterQuerySchema,
    },
    responses: {
      "200": {
        description: "Eventos do organizador carregados.",
        content: { "application/json": { schema: organizerListEventsSchema } },
      },
      "400": {
        description: "Query invalida.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
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
    security: [shared.cookieAuthSecurity],
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
        description: "Payload invalido ou regras de negocio nao atendidas.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
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
    summary: "Lista inscricoes de um evento do organizador autenticado.",
    security: [shared.cookieAuthSecurity],
    request: {
      params: z.object({
        eventId: shared.eventIdParam,
      }),
    },
    responses: {
      "200": {
        description: "Inscricoes do evento carregadas.",
        content: {
          "application/json": { schema: organizerRegistrationsSchema },
        },
      },
      "400": {
        description: "Path param invalido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento nao encontrado.",
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
    summary: "Atualiza o status de uma inscricao em evento do organizador.",
    security: [shared.cookieAuthSecurity],
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
        description: "Payload ou params invalidos.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento ou inscricao nao encontrados.",
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
    security: [shared.cookieAuthSecurity],
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
        description: "Path param invalido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento nao encontrado.",
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
    security: [shared.cookieAuthSecurity],
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
        description: "Path param invalido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento nao encontrado.",
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
    security: [shared.cookieAuthSecurity],
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
        description: "Payload ou path param invalidos.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento nao encontrado.",
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
    security: [shared.cookieAuthSecurity],
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
        description: "Path param invalido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticacao necessaria.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento nao encontrado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });
}
