import { type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../docs/zod-openapi";
import type { SharedBoundaryComponents } from "./shared.contract";

export const publicEventsListQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .openapi({
      param: {
        name: "q",
        in: "query",
        required: false,
        description: "Filtro textual dos eventos publicados.",
      },
    }),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const publicEventIdParamsSchema = z.object({
  eventId: z.coerce.number().int().positive(),
});

export const eventRegistrationBodySchema = z.object({
  participantRole: z
    .string()
    .optional(),
  agreedResponsibility: z.boolean(),
});

export function registerEventsBoundaryContract(
  registry: OpenAPIRegistry,
  shared: SharedBoundaryComponents,
) {
  const publicEventListItemSchema = registry.register(
    "PublicEventListItem",
    z.object({
      id: z.number().int(),
      title: z.string(),
      summary: z.string(),
      org: z.string(),
      startsAt: z.iso.datetime(),
      locationName: z
        .string()
        .nullable(),
      isRemote: z.boolean(),
      capacity: z.number().int().nullable(),
      coverImageUrl: z.url().nullable(),
      imageKey: z.null(),
    }),
  );

  const publicEventsListResponseSchema = registry.register(
    "PublicEventsListResponse",
    z.object({
      data: z.array(publicEventListItemSchema),
      meta: shared.paginationMetaSchema,
    }),
  );

  const publicEventDetailSchema = registry.register(
    "PublicEventDetail",
    z.object({
      id: z.number().int(),
      title: z.string(),
      summary: z.string(),
      description: z
        .string()
        .nullable(),
      rulesTerms: z
        .string()
        .nullable(),
      org: z.string(),
      organizerId: z.number().int(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime().nullable(),
      locationName: z
        .string()
        .nullable(),
      isRemote: z.boolean(),
      capacity: z.number().int().nullable(),
      highlightSkill: z
        .string()
        .nullable(),
      coverImageUrl: z.url().nullable(),
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

  const eventRegistrationResponseSchema = registry.register(
    "EventRegistrationResponse",
    z.object({
      id: z.number().int(),
      eventId: z.number().int(),
      status: z.literal("pending"),
      participantRole: z
        .string()
        .nullable(),
      createdAt: z.iso.datetime(),
    }),
  );

  registry.registerPath({
    method: "get",
    path: "/events",
    tags: ["events"],
    summary: "Lista eventos publicados.",
    security: [],
    request: {
      query: publicEventsListQuerySchema,
    },
    responses: {
      "200": {
        description: "Lista paginada de eventos publicados.",
        content: {
          "application/json": {
            schema: publicEventsListResponseSchema,
          },
        },
      },
      "400": {
        description: "Falha de validação da querystring.",
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
    path: "/events/{eventId}",
    tags: ["events"],
    summary: "Detalha um evento publicado.",
    security: [],
    request: {
      params: z.object({
        eventId: shared.eventIdParam,
      }),
    },
    responses: {
      "200": {
        description: "Detalhes do evento.",
        content: {
          "application/json": {
            schema: publicEventDetailSchema,
          },
        },
      },
      "400": {
        description: "Falha de validação do path param.",
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
    method: "post",
    path: "/events/{eventId}/registrations",
    tags: ["events"],
    summary: "Inscreve o usuário autenticado em um evento publicado.",
    description:
      "Endpoint privado. Envie o JWT de acesso no header Authorization Bearer.",
    security: [shared.bearerAuthSecurity],
    request: {
      params: z.object({
        eventId: shared.eventIdParam,
      }),
      body: {
        required: true,
        content: {
          "application/json": {
            schema: eventRegistrationBodySchema,
          },
        },
      },
    },
    responses: {
      "201": {
        description: "Inscrição criada com sucesso.",
        content: {
          "application/json": {
            schema: eventRegistrationResponseSchema,
          },
        },
      },
      "400": {
        description: "Payload inválido ou regra de negócio não atendida.",
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
      "409": {
        description: "Usuário já inscrito no evento.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });
}
