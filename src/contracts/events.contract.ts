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
      example: "mutirao",
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
    .optional()
    .openapi({ example: "Voluntario de apoio" }),
  agreedResponsibility: z.boolean().openapi({ example: true }),
});

export function registerEventsBoundaryContract(
  registry: OpenAPIRegistry,
  shared: SharedBoundaryComponents,
) {
  const publicEventListItemSchema = registry.register(
    "PublicEventListItem",
    z.object({
      id: z.number().int().openapi({ example: 42 }),
      title: z.string().openapi({ example: "Mutirao de Inverno" }),
      summary: z.string().openapi({
        example: "Acao solidaria para arrecadacao e distribuicao.",
      }),
      org: z.string().openapi({ example: "Instituto Vida" }),
      startsAt: z.iso.datetime().openapi({ example: "2026-05-10T13:00:00.000Z" }),
      locationName: z
        .string()
        .nullable()
        .openapi({ example: "Centro Comunitario Bela Vista" }),
      isRemote: z.boolean().openapi({ example: false }),
      capacity: z.number().int().nullable().openapi({ example: 120 }),
      coverImageUrl: z.url().nullable().openapi({
        example: "https://cdn.amparian.com/events/42-cover.jpg",
      }),
      imageKey: z.null().openapi({ example: null }),
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
      id: z.number().int().openapi({ example: 42 }),
      title: z.string().openapi({ example: "Mutirao de Inverno" }),
      summary: z.string().openapi({
        example: "Acao solidaria para arrecadacao e distribuicao.",
      }),
      description: z
        .string()
        .nullable()
        .openapi({ example: "Traga agasalhos e itens de higiene." }),
      rulesTerms: z
        .string()
        .nullable()
        .openapi({ example: "Uso obrigatorio de cracha." }),
      org: z.string().openapi({ example: "Instituto Vida" }),
      organizerId: z.number().int().openapi({ example: 9 }),
      startsAt: z.iso.datetime().openapi({ example: "2026-05-10T13:00:00.000Z" }),
      endsAt: z.iso.datetime().nullable().openapi({ example: "2026-05-10T18:00:00.000Z" }),
      locationName: z
        .string()
        .nullable()
        .openapi({ example: "Centro Comunitario Bela Vista" }),
      isRemote: z.boolean().openapi({ example: false }),
      capacity: z.number().int().nullable().openapi({ example: 120 }),
      highlightSkill: z
        .string()
        .nullable()
        .openapi({ example: "Organizacao de equipes" }),
      coverImageUrl: z.url().nullable().openapi({
        example: "https://cdn.amparian.com/events/42-cover.jpg",
      }),
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
        .openapi({ example: "upcoming" }),
    }),
  );

  const eventRegistrationResponseSchema = registry.register(
    "EventRegistrationResponse",
    z.object({
      id: z.number().int().openapi({ example: 15 }),
      eventId: z.number().int().openapi({ example: 42 }),
      status: z.literal("pending").openapi({ example: "pending" }),
      participantRole: z
        .string()
        .nullable()
        .openapi({ example: "Voluntario de apoio" }),
      createdAt: z.iso.datetime().openapi({ example: "2026-04-22T20:30:00.000Z" }),
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
        description: "Falha de validacao da querystring.",
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
        description: "Falha de validacao do path param.",
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
    method: "post",
    path: "/events/{eventId}/registrations",
    tags: ["events"],
    summary: "Inscreve o usuario autenticado em um evento publicado.",
    description:
      "Endpoint privado. O navegador envia automaticamente o cookie de sessao apos login.",
    security: [shared.cookieAuthSecurity],
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
        description: "Inscricao criada com sucesso.",
        content: {
          "application/json": {
            schema: eventRegistrationResponseSchema,
          },
        },
      },
      "400": {
        description: "Payload invalido ou regra de negocio nao atendida.",
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
      "409": {
        description: "Usuario ja inscrito no evento.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });
}
