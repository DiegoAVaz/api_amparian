import type { CertificateRecord } from "../../models";
import type {
  CertificateRepository,
  IssuanceContextRow,
} from "../../repositories/certificate.repository";
import type { RegistrationRepository } from "../../repositories/registration.repository";
import {
  assertPrintableParticipantName,
  formatVerificationCode,
  renderCertificatePdf,
  type CertificateDocumentData,
} from "../../services/certificates";
import { generateVerificationCode } from "../../services/certificates/verification-code";
import {
  buildCertificateKey,
  type DocumentStorage,
} from "../../services/storage";
import {
  computeEventStatus,
  effectiveWorkloadHours,
  parseWorkloadHours,
} from "../../utils/event-helpers";
import { HttpError } from "../../utils/http-error";
import { parseDbDate } from "../../utils/knex-helpers";

// Tentativas de sortear um código livre. Com 32¹² combinações, uma colisão já é improvável; cinco
// seguidas significariam um gerador quebrado, e aí é melhor falhar do que insistir.
const CODE_ATTEMPTS = 5;

export type CertificateConfig = {
  /** `APP_WEB_URL`: a base do link de verificação impresso e do QR code. */
  appWebUrl: string;
};

// Pontos de troca para os testes: o gerador do PDF e o sorteio do código. Em produção são as
// funções reais; nos testes, falsos que não dependem da fonte nem do acaso.
export type CertificateTools = {
  render: (data: CertificateDocumentData) => Promise<Buffer>;
  generateCode: () => string;
};

const defaultTools: CertificateTools = {
  render: renderCertificatePdf,
  generateCode: generateVerificationCode,
};

export type CertificateSummary = {
  id: number;
  registrationId: number;
  verificationCode: string;
  issuedAt: string;
  eventTitle: string;
  eventStartsAt: string;
  eventEndsAt: string | null;
  workloadHours: number | null;
};

export function toCertificateSummary(
  record: CertificateRecord,
): CertificateSummary {
  const endsAt = record.event_ends_at
    ? parseDbDate(record.event_ends_at).toISOString()
    : null;
  return {
    id: Number(record.id),
    registrationId: Number(record.registration_id),
    verificationCode: formatVerificationCode(record.verification_code),
    issuedAt: parseDbDate(record.issued_at).toISOString(),
    eventTitle: record.event_title,
    eventStartsAt: parseDbDate(record.event_starts_at).toISOString(),
    eventEndsAt: endsAt,
    workloadHours: parseWorkloadHours(record.event_workload_hours),
  };
}

/** Os dados do PDF a partir do snapshot gravado — os mesmos da emissão, campo a campo (RC-06). */
function documentFromRecord(
  record: CertificateRecord,
  config: CertificateConfig,
): CertificateDocumentData {
  return {
    participantName: record.participant_name,
    eventTitle: record.event_title,
    organizerName: record.organizer_name,
    organizerPersonName: record.organizer_person_name,
    eventStartsAt: parseDbDate(record.event_starts_at),
    eventEndsAt: record.event_ends_at
      ? parseDbDate(record.event_ends_at)
      : null,
    eventLocationName: record.event_location_name,
    eventIsRemote: Boolean(record.event_is_remote),
    workloadHours: parseWorkloadHours(record.event_workload_hours),
    issuedAt: parseDbDate(record.issued_at),
    verificationCode: record.verification_code,
    appWebUrl: config.appWebUrl,
  };
}

/** Confere RC-01 e lança o 422 que diz o que falta. A ordem é a da tela: do mais geral ao mais fino. */
function assertEligible(
  registrationStatus: string,
  ctx: IssuanceContextRow,
): void {
  if (registrationStatus !== "confirmed") {
    throw new HttpError(
      422,
      "REGISTRATION_NOT_CONFIRMED",
      "Só inscrições confirmadas recebem certificado",
    );
  }
  if (ctx.event_status === "cancelled") {
    throw new HttpError(
      422,
      "EVENT_CANCELLED",
      "Evento cancelado não emite certificado",
    );
  }
  const status = computeEventStatus({
    status: ctx.event_status,
    starts_at: parseDbDate(ctx.starts_at),
    ends_at: ctx.ends_at ? parseDbDate(ctx.ends_at) : null,
  });
  if (status !== "ended") {
    throw new HttpError(
      422,
      "EVENT_NOT_ENDED",
      "O certificado fica disponível depois que o evento termina",
    );
  }
  // Sem presença lançada, a tela mostra "Aguardando o organizador" (RC-01); com falta registrada,
  // não há o que esperar. Por isso são dois códigos.
  if (ctx.attendance_status === null) {
    throw new HttpError(
      422,
      "ATTENDANCE_NOT_RECORDED",
      "O organizador ainda não registrou a presença deste evento",
    );
  }
  if (ctx.attendance_status !== "present") {
    throw new HttpError(
      422,
      "ATTENDANCE_ABSENT",
      "O organizador registrou ausência para esta inscrição, por isso não há certificado",
    );
  }
}

/** Envia o PDF e grava a chave. Falhar aqui não desfaz nada: o snapshot já basta para gerar de novo. */
async function storePdf(
  certificates: CertificateRepository,
  storage: DocumentStorage,
  input: {
    certificateId: number;
    userId: number;
    expectedKey: string | null;
    pdf: Buffer;
  },
): Promise<string | null> {
  const key = buildCertificateKey(input.userId);
  try {
    await storage.put(key, {
      buffer: input.pdf,
      contentType: "application/pdf",
    });
  } catch (error) {
    console.error(
      `[certificados] o PDF do certificado ${input.certificateId} não foi enviado; será gerado de novo no próximo download:`,
      error,
    );
    return null;
  }

  let written = 0;
  try {
    written = await certificates.setBlobKey(
      input.certificateId,
      key,
      input.expectedKey,
    );
  } catch (error) {
    console.error(
      `[certificados] a chave do PDF do certificado ${input.certificateId} não foi gravada:`,
      error,
    );
  }
  if (written) return key;

  // A chave não foi gravada (falha, ou outra requisição chegou antes): o blob enviado não é de
  // ninguém e seria um órfão no container. Mesmo molde do upload de imagem.
  try {
    await storage.delete(key);
  } catch (error) {
    console.error(`[certificados] o blob ${key} segue órfão:`, error);
  }
  return null;
}

/**
 * Emissão do certificado pelo próprio voluntário (RC-05), no primeiro "Emitir e baixar".
 *
 * Tudo o que decide e grava acontece numa transação que trava a inscrição: a mesma linha que a lista
 * de presença trava. Assim a emissão e uma mudança de presença nunca se cruzam (RC-04), e dois
 * cliques simultâneos se enfileiram — o segundo encontra o certificado do primeiro.
 *
 * O PDF é gerado ANTES de gravar a linha, dentro da transação. Qualquer recusa do gerador (nome ou
 * título que não se imprimem, texto que não cabe) desfaz tudo, e nunca sobra um certificado que não
 * se consegue gerar. O envio ao container fica depois do commit: se falhar, a linha existe sem
 * chave, e o download gera o PDF de novo a partir do snapshot.
 */
export class IssueCertificateUseCase {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly registrations: RegistrationRepository,
    private readonly storage: DocumentStorage,
    private readonly config: CertificateConfig,
    private readonly tools: CertificateTools = defaultTools,
  ) {}

  async execute(
    userId: number,
    registrationId: number,
  ): Promise<{ certificate: CertificateSummary; created: boolean }> {
    const outcome = await this.certificates.transaction(async (trx) => {
      const registration = await this.registrations.findByIdForUserForUpdate(
        userId,
        registrationId,
        trx,
      );
      // Inscrição de outra pessoa responde como inexistente (RN05).
      if (!registration) {
        throw new HttpError(
          404,
          "REGISTRATION_NOT_FOUND",
          "Inscrição não encontrada",
        );
      }

      // Pedir de novo devolve o mesmo certificado, sem conferir nada outra vez: o que foi emitido é
      // definitivo (RC-04), mesmo que o evento tenha mudado depois.
      const existing = await this.certificates.findByRegistrationId(
        registrationId,
        trx,
      );
      if (existing) return { record: existing, pdf: null, created: false };

      const ctx = await this.certificates.findIssuanceContext(
        registrationId,
        trx,
      );
      if (!ctx) {
        throw new HttpError(
          404,
          "REGISTRATION_NOT_FOUND",
          "Inscrição não encontrada",
        );
      }

      assertEligible(registration.status, ctx);
      assertPrintableParticipantName(ctx.participant_name);

      const startsAt = parseDbDate(ctx.starts_at);
      const endsAt = ctx.ends_at ? parseDbDate(ctx.ends_at) : null;
      const workloadHours = effectiveWorkloadHours({
        workload_hours: ctx.workload_hours,
        starts_at: startsAt,
        ends_at: endsAt,
      });
      // "Promovida por" é a organização pública do organizador; sem ela, o nome dele (RC-06).
      const organizerName =
        ctx.organizer_public_name?.trim() || ctx.organizer_name;
      // Segundos inteiros: o PDF registra a emissão com precisão de segundo (data impressa e
      // metadados), e a API devolve o mesmo instante — sem um `issuedAt` com milissegundos que o
      // documento não mostra.
      const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000);

      const snapshot = {
        registration_id: registrationId,
        participant_name: ctx.participant_name,
        event_title: ctx.event_title,
        organizer_name: organizerName,
        organizer_person_name: ctx.organizer_name,
        event_starts_at: startsAt,
        event_ends_at: endsAt,
        event_location_name: ctx.location_name,
        event_is_remote: Boolean(ctx.is_remote),
        event_workload_hours:
          workloadHours === null ? null : workloadHours.toFixed(2),
        issued_at: issuedAt,
      };

      for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
        const verificationCode = this.tools.generateCode();
        const row = { ...snapshot, verification_code: verificationCode };
        // O código vai impresso: cada sorteio novo gera o PDF de novo.
        const pdf = await this.tools.render(
          documentFromRecord({ ...row, id: 0, blob_key: null }, this.config),
        );

        const result = await this.certificates.insert(row, trx);
        if (result.ok) {
          return {
            record: {
              ...row,
              id: result.id,
              blob_key: null,
            } as CertificateRecord,
            pdf,
            created: true,
          };
        }
        if (result.conflict === "registration") {
          // Só acontece se a trava da inscrição falhar. Mesmo assim, a resposta certa é o
          // certificado que já existe; se esta transação não o enxerga (leitura consistente),
          // falha com um código próprio, e não fingindo falta de código livre.
          const raced = await this.certificates.findByRegistrationId(
            registrationId,
            trx,
          );
          if (raced) return { record: raced, pdf: null, created: false };
          throw new HttpError(
            409,
            "CERTIFICATE_ISSUE_CONFLICT",
            "O certificado desta inscrição acabou de ser emitido. Tente de novo",
          );
        }
        // Colisão de código (RC-07): sorteia outro.
      }

      throw new HttpError(
        500,
        "CERTIFICATE_CODE_UNAVAILABLE",
        "Não foi possível emitir o certificado agora. Tente de novo",
      );
    });

    if (outcome.created && outcome.pdf) {
      const key = await storePdf(this.certificates, this.storage, {
        certificateId: Number(outcome.record.id),
        userId,
        expectedKey: null,
        pdf: outcome.pdf,
      });
      outcome.record.blob_key = key;
    }

    return {
      certificate: toCertificateSummary(outcome.record),
      created: outcome.created,
    };
  }
}

/**
 * Download do PDF pelo dono do certificado (RC-09). Nunca há URL pública: o arquivo sai do container
 * privado pela API, depois de conferido o dono.
 *
 * Se o PDF não estiver no container (o envio da emissão falhou, ou o blob se perdeu), ele é gerado
 * de novo a partir do snapshot — idêntico ao original — e enviado outra vez (RC-05). Se o container
 * estiver fora do ar, o voluntário recebe o PDF gerado na hora mesmo assim.
 */
export class DownloadCertificateUseCase {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly storage: DocumentStorage,
    private readonly config: CertificateConfig,
    private readonly tools: Pick<CertificateTools, "render"> = defaultTools,
  ) {}

  async execute(
    userId: number,
    certificateId: number,
  ): Promise<{ pdf: Buffer; fileName: string }> {
    const record = await this.certificates.findByIdForUser(
      certificateId,
      userId,
    );
    // Certificado de outra pessoa responde como inexistente (RN05).
    if (!record) {
      throw new HttpError(
        404,
        "CERTIFICATE_NOT_FOUND",
        "Certificado não encontrado",
      );
    }

    const fileName = `certificado-amparian-${formatVerificationCode(record.verification_code)}.pdf`;

    let storageAvailable = true;
    if (record.blob_key) {
      try {
        const stored = await this.storage.get(record.blob_key);
        if (stored) return { pdf: stored, fileName };
      } catch (error) {
        storageAvailable = false;
        console.error(
          `[certificados] não foi possível ler o PDF do certificado ${record.id}; gerando a partir do snapshot:`,
          error,
        );
      }
    }

    const pdf = await this.tools.render(
      documentFromRecord(record, this.config),
    );

    // Com o container respondendo, guarda o PDF regenerado para o próximo download. Fora do ar,
    // tentar enviar só atrasaria a resposta e falharia de novo.
    if (storageAvailable) {
      await storePdf(this.certificates, this.storage, {
        certificateId: Number(record.id),
        userId,
        expectedKey: record.blob_key,
        pdf,
      });
    }

    return { pdf, fileName };
  }
}
