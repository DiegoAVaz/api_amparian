import { type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../docs/zod-openapi";
import { normalizeVerificationCode } from "../services/certificates/verification-code";
import type { SharedBoundaryComponents } from "./shared.contract";

export const certificateIdParamsSchema = z.object({
  certificateId: z.coerce
    .number({ error: "O ID do certificado deve ser um número" })
    .int({ error: "O ID do certificado deve ser um número inteiro" })
    .positive({ error: "O ID do certificado deve ser maior que 0" }),
});

// O código como alguém digita ou lê do QR — com ou sem hífens, maiúsculo ou não — vira o formato
// gravado antes de chegar ao caso de uso (RC-07). O que não pode ser um código é recusado aqui, sem
// consultar o banco.
export const certificateVerifyParamsSchema = z.object({
  code: z
    .string({ error: "O código de verificação é obrigatório" })
    .max(64, { error: "Código de verificação inválido" })
    .transform((value, ctx) => {
      const normalized = normalizeVerificationCode(value);
      if (normalized === null) {
        ctx.addIssue({
          code: "custom",
          message: "Código de verificação inválido",
        });
        return z.NEVER;
      }
      return normalized;
    }),
});

// Metadados de um certificado emitido. O código vem formatado para leitura ("R4WT-8HZN-2QKC"), como
// está impresso no PDF.
const certificateBoundarySchema = z.object({
  id: z.number().int(),
  registrationId: z.number().int(),
  verificationCode: z.string(),
  issuedAt: z.iso.datetime(),
  eventTitle: z.string(),
  eventStartsAt: z.iso.datetime(),
  eventEndsAt: z.iso.datetime().nullable(),
  workloadHours: z.number().nullable(),
});

const certificateListItemBoundarySchema = z.object({
  registrationId: z.number().int(),
  status: z
    .enum([
      "issued",
      "available",
      "awaiting_attendance",
      "attendance_not_recorded",
    ])
    .describe(
      "issued: certificado emitido. available: presença registrada, pronto para emitir. awaiting_attendance: o organizador ainda pode lançar a presença. attendance_not_recorded: a janela de presença fechou sem lançamento.",
    ),
  eventTitle: z.string(),
  eventStartsAt: z.iso.datetime(),
  eventEndsAt: z.iso.datetime().nullable(),
  workloadHours: z
    .number()
    .nullable()
    .describe(
      "No certificado emitido, a carga impressa; nos demais, a carga efetiva que sairia se fosse emitido agora. Nula quando o certificado mostra só o período.",
    ),
  attendanceClosesAt: z.iso
    .datetime()
    .nullable()
    .describe(
      "Só em awaiting_attendance: até quando o organizador pode lançar a presença.",
    ),
  certificate: z
    .object({
      id: z.number().int(),
      verificationCode: z.string(),
      issuedAt: z.iso.datetime(),
    })
    .nullable(),
});

export function registerCertificatesBoundaryContract(
  registry: OpenAPIRegistry,
  shared: SharedBoundaryComponents,
) {
  const certificateSchema = registry.register(
    "Certificate",
    certificateBoundarySchema,
  );

  const certificateListSchema = registry.register(
    "CertificateListResponse",
    z.object({
      data: z.array(certificateListItemBoundarySchema),
      summary: z.object({
        issuedCount: z.number().int(),
        certifiedHours: z.number(),
      }),
    }),
  );

  const certificateIdParam = registry.registerParameter(
    "CertificateId",
    z.coerce.number().int().positive().openapi({
      param: {
        name: "certificateId",
        in: "path",
        description: "ID numérico do certificado.",
        required: true,
      },
    }),
  );

  const unauthorized = {
    description: "Autenticação necessária.",
    content: { "application/json": { schema: shared.errorEnvelopeSchema } },
  };

  registry.registerPath({
    method: "get",
    path: "/me/certificates",
    tags: ["certificates"],
    summary:
      "Lista os certificados do usuário e os eventos encerrados que ainda podem render um.",
    description:
      "Do evento mais recente para o mais antigo. Inscrições com falta registrada não aparecem. `summary` traz o total de certificados emitidos e a soma das horas impressas neles.",
    security: [shared.bearerAuthSecurity],
    responses: {
      "200": {
        description: "Certificados carregados.",
        content: { "application/json": { schema: certificateListSchema } },
      },
      "401": unauthorized,
      "500": {
        description: "Erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/me/registrations/{registrationId}/certificate",
    tags: ["certificates"],
    summary: "Emite o certificado de participação de uma inscrição do usuário.",
    description:
      "Idempotente: pedir de novo devolve o mesmo certificado, com 200. A partir da emissão, a presença dessa inscrição não muda mais.",
    security: [shared.bearerAuthSecurity],
    request: {
      params: z.object({ registrationId: shared.registrationIdParam }),
    },
    responses: {
      "200": {
        description: "O certificado já existia; é devolvido sem mudança.",
        content: { "application/json": { schema: certificateSchema } },
      },
      "201": {
        description: "Certificado emitido.",
        content: { "application/json": { schema: certificateSchema } },
      },
      "400": {
        description: "Path param inválido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": unauthorized,
      "404": {
        description:
          "REGISTRATION_NOT_FOUND: a inscrição não existe ou é de outra pessoa.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "409": {
        description:
          "CERTIFICATE_ISSUE_CONFLICT: outra requisição emitiu o certificado ao mesmo tempo; tentar de novo devolve o certificado.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "422": {
        description:
          "REGISTRATION_NOT_CONFIRMED, EVENT_CANCELLED, EVENT_NOT_ENDED, ATTENDANCE_NOT_RECORDED (o organizador ainda não lançou a presença), ATTENDANCE_ABSENT, CERTIFICATE_NAME_UNPRINTABLE (o nome do perfil tem letras que o certificado não imprime) ou CERTIFICATE_EVENT_UNPRINTABLE (o título do evento ou o nome da organização não se imprimem).",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description:
          "CERTIFICATE_CODE_UNAVAILABLE, CERTIFICATE_LAYOUT_OVERFLOW, INVALID_CERTIFICATE_DATA ou erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });

  const publicCertificateSchema = registry.register(
    "PublicCertificate",
    z.object({
      verificationCode: z.string(),
      participantName: z.string(),
      eventTitle: z.string(),
      organizerName: z.string(),
      responsiblePersonName: z
        .string()
        .nullable()
        .describe(
          "A linha \"Responsável:\" do certificado: o nome do organizador quando a ação é promovida pela organização pública dele. Nula quando o certificado não imprime essa linha.",
        ),
      eventStartsAt: z.iso.datetime(),
      eventEndsAt: z.iso.datetime().nullable(),
      eventLocationName: z.string().nullable(),
      eventIsRemote: z.boolean(),
      workloadHours: z.number().nullable(),
      issuedAt: z.iso.datetime(),
    }),
  );

  registry.registerPath({
    method: "get",
    path: "/certificates/verify/{code}",
    tags: ["certificates"],
    summary: "Verifica um certificado pelo código impresso, sem login.",
    description:
      "Aceita o código com ou sem hífens, em maiúsculas ou minúsculas. Devolve só o que está impresso no certificado. Não existe certificado revogado: o resultado é válido (200) ou não encontrado (404). Limitada por IP.",
    // Rota pública: sem token, mesmo se um dia o documento ganhar segurança global.
    security: [],
    request: {
      params: z.object({
        code: z.string().max(64).openapi({
          example: "R4WT-8HZN-2QKC",
          param: {
            name: "code",
            in: "path",
            description:
              "Código de verificação: 12 símbolos de A–Z e 2–9, sem I, O, 0 e 1. Hífens, espaços e minúsculas são aceitos e ignorados.",
            required: true,
          },
        }),
      }),
    },
    responses: {
      "200": {
        description: "Certificado válido.",
        content: { "application/json": { schema: publicCertificateSchema } },
      },
      "400": {
        description:
          "INVALID_ROUTE_PARAMS: o texto não pode ser um código (tamanho ou símbolos fora do alfabeto).",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "404": {
        description: "CERTIFICATE_NOT_FOUND: nenhum certificado com este código.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "429": {
        description: "TOO_MANY_REQUESTS: muitas consultas deste IP.",
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
    path: "/me/certificates/{certificateId}/pdf",
    tags: ["certificates"],
    summary: "Baixa o PDF de um certificado do usuário.",
    description:
      "O arquivo sai do armazenamento privado pela API, nunca por URL pública. Se o PDF guardado se perdeu, é gerado de novo a partir dos dados da emissão, idêntico ao original.",
    security: [shared.bearerAuthSecurity],
    request: {
      params: z.object({ certificateId: certificateIdParam }),
    },
    responses: {
      "200": {
        description: "O PDF do certificado.",
        headers: {
          "Content-Disposition": {
            description:
              'attachment; filename="certificado-amparian-XXXX-XXXX-XXXX.pdf"',
            schema: { type: "string" },
          },
          "Cache-Control": {
            description: "private, no-store",
            schema: { type: "string" },
          },
        },
        content: {
          "application/pdf": {
            schema: z.string().openapi({ type: "string", format: "binary" }),
          },
        },
      },
      "400": {
        description: "Path param inválido.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "401": unauthorized,
      "404": {
        description:
          "CERTIFICATE_NOT_FOUND: o certificado não existe ou é de outra pessoa.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
      "500": {
        description:
          "INVALID_CERTIFICATE_DATA, CERTIFICATE_LAYOUT_OVERFLOW ou erro interno.",
        content: { "application/json": { schema: shared.errorEnvelopeSchema } },
      },
    },
  });
}
