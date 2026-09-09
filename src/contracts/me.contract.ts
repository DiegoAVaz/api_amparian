import { type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../docs/zod-openapi";
import { nullableProfilePhoneSchema } from "./phone.contract";
import type { SharedBoundaryComponents } from "./shared.contract";

const unsignedIntegerMax = 4_294_967_295;
const textColumnMaxLength = 65_535;

function requiredTrimmedString(maxLength: number, fieldLabel: string) {
  return z
    .string({ error: `O campo ${fieldLabel} deve ser texto` })
    .trim()
    .min(1, { error: `O campo ${fieldLabel} é obrigatório` })
    .max(maxLength, {
      error: `O campo ${fieldLabel} deve ter no máximo ${maxLength} caracteres`,
    });
}

function nullableTrimmedString(
  maxLength: number,
  fieldLabel: string,
  minLength?: number,
) {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined || typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z
      .string()
      .min(minLength ?? 0, {
        error: `O campo ${fieldLabel} deve ter pelo menos ${minLength ?? 0} caracteres`,
      })
      .max(maxLength, {
        error: `O campo ${fieldLabel} deve ter no máximo ${maxLength} caracteres`,
      })
      .nullable()
      .optional(),
  );
}

function nullableOptionalTrimmedString(maxLength: number, fieldLabel: string) {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined || typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z
      .string({ error: `O campo ${fieldLabel} deve ser texto` })
      .max(maxLength, {
        error: `O campo ${fieldLabel} deve ter no máximo ${maxLength} caracteres`,
      })
      .nullable()
      .optional(),
  );
}

function lookupCodeArraySchema(
  fieldLabel: string,
  options: { required: boolean },
) {
  const arraySchema = z
    .array(
      z
        .string({ error: `Cada código de ${fieldLabel} deve ser texto` })
        .trim()
        .min(1, { error: `Cada código de ${fieldLabel} deve ser informado` })
        .max(64, {
          error: `Cada código de ${fieldLabel} deve ter no máximo 64 caracteres`,
        }),
      { error: `O campo ${fieldLabel} deve ser uma lista` },
    )
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      value.forEach((code, index) => {
        if (seen.has(code)) {
          ctx.addIssue({
            code: "custom",
            message: `Não informe códigos duplicados em ${fieldLabel}`,
            path: [index],
          });
          return;
        }
        seen.add(code);
      });
    });

  return options.required
    ? arraySchema.min(1, { error: `Informe ao menos um item em ${fieldLabel}` })
    : arraySchema;
}

const profileStateSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined || typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.toUpperCase() : null;
  },
  z
    .string()
    .length(2, { error: "O estado deve ser informado como UF com 2 letras" })
    .regex(/^[A-Z]{2}$/, { error: "O estado deve conter apenas letras" })
    .nullable()
    .optional(),
);

export const meProfilePatchBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, { error: "O nome deve ter pelo menos 2 caracteres" })
      .max(255, { error: "O nome deve ter no máximo 255 caracteres" })
      .optional(),
    phone: nullableProfilePhoneSchema,
    city: nullableTrimmedString(128, "cidade"),
    state: profileStateSchema,
    bio: nullableTrimmedString(5000, "bio"),
    publicOrganizationName: nullableTrimmedString(255, "organização pública"),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > 0) {
      return;
    }

    ctx.addIssue({
      code: "custom",
      message: "Informe ao menos um campo para atualizar",
      path: [],
    });
  });

export const meRegistrationsQuerySchema = z.object({
  page: z.coerce
    .number({ error: "A página deve ser um número" })
    .int({ error: "A página deve ser um número inteiro" })
    .min(1, { error: "A página deve ser maior ou igual a 1" })
    .default(1),
  limit: z.coerce
    .number({ error: "O limite deve ser um número" })
    .int({ error: "O limite deve ser um número inteiro" })
    .min(1, { error: "O limite deve ser maior ou igual a 1" })
    .max(100, { error: "O limite deve ser menor ou igual a 100" })
    .default(20),
});

export const meAgendaQuerySchema = z.object({
  year: z.coerce
    .number({ error: "O ano deve ser um número" })
    .int({ error: "O ano deve ser um número inteiro" })
    .min(2000, { error: "O ano deve ser maior ou igual a 2000" })
    .max(2100, { error: "O ano deve ser menor ou igual a 2100" })
    .openapi({
      param: { name: "year", in: "query", required: true },
    }),
  month: z.coerce
    .number({ error: "O mês deve ser um número" })
    .int({ error: "O mês deve ser um número inteiro" })
    .min(1, { error: "O mês deve ser maior ou igual a 1" })
    .max(12, { error: "O mês deve ser menor ou igual a 12" })
    .openapi({
      param: { name: "month", in: "query", required: true },
    }),
});

export const meEventsFilterQuerySchema = z.object({
  filter: z
    .preprocess(
      (value) => {
        if (
          value === null ||
          value === undefined ||
          typeof value !== "string"
        ) {
          return value;
        }

        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      },
      z
        .enum(["upcoming", "past", "ongoing"], {
          error: "O filtro deve ser upcoming, past ou ongoing",
        })
        .optional(),
    )
    .openapi({
      param: { name: "filter", in: "query", required: false },
    }),
});

export const createEventBodySchema = z
  .object({
    title: requiredTrimmedString(255, "título"),
    summary: requiredTrimmedString(textColumnMaxLength, "resumo"),
    description: nullableOptionalTrimmedString(
      textColumnMaxLength,
      "descrição",
    ),
    rulesTerms: nullableOptionalTrimmedString(
      textColumnMaxLength,
      "termos e regras",
    ),
    startsAt: z.iso.datetime({
      error: "A data de início deve estar em formato ISO 8601",
    }),
    endsAt: z.iso
      .datetime({
        error: "A data de término deve estar em formato ISO 8601",
      })
      .nullable()
      .optional(),
    locationName: nullableOptionalTrimmedString(255, "local"),
    isRemote: z.boolean({ error: "Informe se o evento é remoto" }),
    capacity: z
      .number({ error: "A capacidade deve ser um número" })
      .int({ error: "A capacidade deve ser um número inteiro" })
      .min(1, { error: "A capacidade deve ser maior que 0" })
      .max(unsignedIntegerMax, {
        error: `A capacidade deve ser menor ou igual a ${unsignedIntegerMax}`,
      })
      .nullable()
      .optional(),
    highlightSkill: nullableOptionalTrimmedString(
      255,
      "habilidade em destaque",
    ),
    typeCodes: lookupCodeArraySchema("tipos de evento", { required: true }),
    requirementCodes: lookupCodeArraySchema("requisitos", { required: false }),
    publish: z.boolean({ error: "Informe se o evento deve ser publicado" }),
  })
  .superRefine((value, ctx) => {
    if (!value.endsAt) return;
    const startsAt = new Date(value.startsAt).getTime();
    const endsAt = new Date(value.endsAt).getTime();
    if (endsAt <= startsAt) {
      ctx.addIssue({
        code: "custom",
        message: "A data de término deve ser maior que a data de início",
        path: ["endsAt"],
      });
    }
  });

export const patchEventBodySchema = z
  .object({
    title: requiredTrimmedString(255, "título").optional(),
    summary: requiredTrimmedString(textColumnMaxLength, "resumo").optional(),
    description: nullableOptionalTrimmedString(
      textColumnMaxLength,
      "descrição",
    ),
    rulesTerms: nullableOptionalTrimmedString(
      textColumnMaxLength,
      "termos e regras",
    ),
    startsAt: z.iso
      .datetime({
        error: "A data de início deve estar em formato ISO 8601",
      })
      .optional(),
    endsAt: z.iso
      .datetime({
        error: "A data de término deve estar em formato ISO 8601",
      })
      .nullable()
      .optional(),
    locationName: nullableOptionalTrimmedString(255, "local"),
    isRemote: z.boolean({ error: "Informe se o evento é remoto" }).optional(),
    capacity: z
      .number({ error: "A capacidade deve ser um número" })
      .int({ error: "A capacidade deve ser um número inteiro" })
      .min(1, { error: "A capacidade deve ser maior que 0" })
      .max(unsignedIntegerMax, {
        error: `A capacidade deve ser menor ou igual a ${unsignedIntegerMax}`,
      })
      .nullable()
      .optional(),
    highlightSkill: nullableOptionalTrimmedString(
      255,
      "habilidade em destaque",
    ),
    typeCodes: lookupCodeArraySchema("tipos de evento", {
      required: true,
    }).optional(),
    requirementCodes: lookupCodeArraySchema("requisitos", {
      required: false,
    }).optional(),
    publish: z
      .boolean({ error: "Informe se o evento deve ser publicado" })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Informe ao menos um campo para atualizar",
        path: [],
      });
      return;
    }

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
        code: "custom",
        message: "A data de término deve ser maior que a data de início",
        path: ["endsAt"],
      });
    }
  });

export const updateOrganizerRegistrationBodySchema = z.object({
  status: z.enum(["pending", "confirmed", "cancelled"], {
    error: "O status deve ser pending, confirmed ou cancelled",
  }),
});

export const meEventIdParamsSchema = z.object({
  eventId: z.coerce
    .number({ error: "O ID do evento deve ser um número" })
    .int({ error: "O ID do evento deve ser um número inteiro" })
    .positive({ error: "O ID do evento deve ser maior que 0" }),
});

export const meRegistrationIdParamsSchema = z.object({
  registrationId: z.coerce
    .number({ error: "O ID da inscrição deve ser um número" })
    .int({ error: "O ID da inscrição deve ser um número inteiro" })
    .positive({ error: "O ID da inscrição deve ser maior que 0" }),
});

export const meEventRegistrationParamsSchema = z.object({
  eventId: z.coerce
    .number({ error: "O ID do evento deve ser um número" })
    .int({ error: "O ID do evento deve ser um número inteiro" })
    .positive({ error: "O ID do evento deve ser maior que 0" }),
  registrationId: z.coerce
    .number({ error: "O ID da inscrição deve ser um número" })
    .int({ error: "O ID da inscrição deve ser um número inteiro" })
    .positive({ error: "O ID da inscrição deve ser maior que 0" }),
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
      status: z.enum(["pending", "confirmed", "cancelled"]),
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
          filter: z.enum(["upcoming", "past", "ongoing"]),
          statusLabel: z.string(),
          description: z.string(),
          coverImageUrl: z.url().nullable(),
          imageClassName: z.string(),
          startsAt: z.iso.datetime(),
          status: z.enum(["draft", "published", "cancelled"]),
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
      description: z.string().nullable(),
      rules_terms: z.string().nullable(),
      starts_at: z.iso.datetime(),
      ends_at: z.iso.datetime().nullable(),
      location_name: z.string().nullable(),
      is_remote: z.boolean(),
      capacity: z.number().int().nullable(),
      cover_image_url: z.url().nullable(),
      highlight_skill: z.string().nullable(),
      status: z.enum(["draft", "published", "cancelled"]),
      created_at: z.iso.datetime().optional(),
      updated_at: z.iso.datetime().optional(),
      types: z.array(shared.lookupOptionSchema),
      requirements: z.array(shared.lookupOptionSchema),
      computedStatus: z.enum([
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
          status: z.enum(["pending", "confirmed", "cancelled"]),
        }),
      ),
    }),
  );

  const updateRegistrationStatusSchema = registry.register(
    "UpdateRegistrationStatusResponse",
    z.object({
      id: z.number().int(),
      status: z.enum(["pending", "confirmed", "cancelled"]),
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

  const uploadRequestBody = {
    required: true,
    content: {
      "multipart/form-data": {
        schema: z.object({
          file: z
            .string()
            .openapi({ type: "string", format: "binary" })
            .describe("Imagem JPEG, PNG ou WebP"),
        }),
      },
    },
  };

  const uploadErrorResponses = {
    "400": {
      description:
        "Arquivo ausente, corpo multipart malformado, campo inesperado, campos além do arquivo ou, nas rotas com parâmetro, um id de rota inválido.",
      content: { "application/json": { schema: shared.errorEnvelopeSchema } },
    },
    "401": {
      description: "Autenticação necessária.",
      content: { "application/json": { schema: shared.errorEnvelopeSchema } },
    },
    "413": {
      description: "Imagem acima do tamanho máximo permitido.",
      content: { "application/json": { schema: shared.errorEnvelopeSchema } },
    },
    "415": {
      description:
        "Os bytes enviados não são de uma imagem JPEG, PNG ou WebP. A extensão e o Content-Type declarados são ignorados.",
      content: { "application/json": { schema: shared.errorEnvelopeSchema } },
    },
    "429": {
      description: "Muitos envios de imagem em sequência.",
      content: { "application/json": { schema: shared.errorEnvelopeSchema } },
    },
    "500": {
      description: "Erro interno.",
      content: { "application/json": { schema: shared.errorEnvelopeSchema } },
    },
  };

  registry.registerPath({
    method: "post",
    path: "/me/avatar",
    tags: ["me"],
    summary: "Envia a foto de perfil do usuário autenticado.",
    description:
      "Substitui a foto atual. A imagem anterior é removida do armazenamento.",
    security: [shared.bearerAuthSecurity],
    request: { body: uploadRequestBody },
    responses: {
      "200": {
        description: "Perfil atualizado com a nova foto.",
        content: { "application/json": { schema: shared.userSchema } },
      },
      "404": {
        description:
          "Usuário do token não existe mais — acontece com um token ainda dentro da validade após o banco ser recriado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      ...uploadErrorResponses,
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/me/avatar",
    tags: ["me"],
    summary: "Remove a foto de perfil do usuário autenticado.",
    security: [shared.bearerAuthSecurity],
    responses: {
      "200": {
        description: "Perfil atualizado sem foto.",
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
    method: "post",
    path: "/me/events/{eventId}/cover",
    tags: ["me"],
    summary: "Envia a imagem de capa de um evento do organizador autenticado.",
    description:
      "Substitui a capa atual. A imagem anterior é removida do armazenamento. Responde 404 tanto para evento inexistente quanto para evento de outro organizador.",
    security: [shared.bearerAuthSecurity],
    request: {
      params: z.object({ eventId: shared.eventIdParam }),
      body: uploadRequestBody,
    },
    responses: {
      "200": {
        description: "Evento atualizado com a nova capa.",
        content: { "application/json": { schema: organizerEventSchema } },
      },
      "404": {
        description: "Evento não encontrado ou de outro organizador.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      ...uploadErrorResponses,
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/me/events/{eventId}/cover",
    tags: ["me"],
    summary: "Remove a imagem de capa de um evento do organizador autenticado.",
    security: [shared.bearerAuthSecurity],
    request: { params: z.object({ eventId: shared.eventIdParam }) },
    responses: {
      "200": {
        description: "Evento atualizado sem capa.",
        content: { "application/json": { schema: organizerEventSchema } },
      },
      "400": {
        description: "Id de rota inválido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": {
        description: "Autenticação necessária.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "Evento não encontrado ou de outro organizador.",
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
      "422": {
        description: "Inscrição não pode ser cancelada no estado atual.",
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
        description:
          "Payload inválido, códigos de catálogo inválidos ou datas inválidas.",
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
      "422": {
        description:
          "Status da inscrição não pode ser alterado no estado atual.",
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
      "422": {
        description: "Evento não pode ser publicado no estado atual.",
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
      "422": {
        description: "Evento não pode ser removido no estado atual.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });
}
