import type { CertificateRecord } from "../../models";
import type {
  CertificateRepository,
  IssuanceContextRow,
} from "../../repositories/certificate.repository";
import type { RegistrationRepository } from "../../repositories/registration.repository";
import {
  assertPrintableParticipantName,
  formatVerificationCode,
  printsResponsiblePerson,
  renderCertificatePdf,
  type CertificateDocumentData,
} from "../../services/certificates";
import { generateVerificationCode } from "../../services/certificates/verification-code";
import {
  buildCertificateKey,
  type DocumentStorage,
} from "../../services/storage";
import {
  attendanceWindowClosesAt,
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

// Os estados de um evento em "Meus certificados". Falta registrada não aparece: não há certificado
// nem o que esperar (RC-01).
//   - issued: o certificado existe; a tela oferece "Baixar PDF".
//   - available: presença registrada, ainda sem certificado; a tela oferece "Emitir e baixar".
//   - awaiting_attendance: o organizador ainda pode lançar a presença; "Aguardando o organizador".
//   - attendance_not_recorded: a janela de presença fechou sem lançamento; "Sem presença".
export type CertificateListStatus =
  | "issued"
  | "available"
  | "awaiting_attendance"
  | "attendance_not_recorded";

export type CertificateListItem = {
  registrationId: number;
  status: CertificateListStatus;
  eventTitle: string;
  eventStartsAt: string;
  eventEndsAt: string | null;
  workloadHours: number | null;
  /** Só em `awaiting_attendance`: até quando o organizador pode lançar a presença (RC-02). */
  attendanceClosesAt: string | null;
  certificate: {
    id: number;
    verificationCode: string;
    issuedAt: string;
  } | null;
};

export type CertificateList = {
  data: CertificateListItem[];
  summary: { issuedCount: number; certifiedHours: number };
};

/**
 * "Meus certificados": os certificados emitidos e os eventos encerrados que ainda podem render um.
 *
 * O certificado emitido mostra o snapshot (RC-06), e não o evento de hoje — é o que está impresso.
 * Os demais mostram o evento como ele está, com a carga horária efetiva que sairia no certificado
 * se fosse emitido agora (RC-03).
 *
 * Decisão de 18/11/2026: depois que a janela de presença fecha sem lançamento, o evento continua na
 * lista como "Sem presença", para o voluntário entender por que não recebeu o certificado.
 */
export class ListMyCertificatesUseCase {
  constructor(private readonly certificates: CertificateRepository) {}

  async execute(userId: number): Promise<CertificateList> {
    const now = new Date();
    // Em sequência, e nesta ordem, para uma emissão em outra aba não deixar o evento duplicado nem
    // sumido nesta resposta: o certificado gravado antes da primeira leitura já não é candidato, e
    // o gravado entre as duas aparece nas duas — e aí vale o emitido (filtro abaixo).
    const candidates = await this.certificates.listCandidatesByUser(
      userId,
      now,
    );
    const issued = await this.certificates.listByUser(userId);
    const issuedRegistrations = new Set(
      issued.map((record) => Number(record.registration_id)),
    );

    const items: CertificateListItem[] = issued.map((record) => {
      const summary = toCertificateSummary(record);
      return {
        registrationId: summary.registrationId,
        status: "issued",
        eventTitle: summary.eventTitle,
        eventStartsAt: summary.eventStartsAt,
        eventEndsAt: summary.eventEndsAt,
        workloadHours: summary.workloadHours,
        attendanceClosesAt: null,
        certificate: {
          id: summary.id,
          verificationCode: summary.verificationCode,
          issuedAt: summary.issuedAt,
        },
      };
    });

    for (const row of candidates) {
      if (issuedRegistrations.has(Number(row.registration_id))) continue;
      const startsAt = parseDbDate(row.starts_at);
      const endsAt = row.ends_at ? parseDbDate(row.ends_at) : null;
      // A mesma régua da emissão (RC-01): só evento encerrado entra.
      const computed = computeEventStatus({
        status: row.event_status,
        starts_at: startsAt,
        ends_at: endsAt,
      });
      if (computed !== "ended") continue;

      let status: CertificateListStatus = "available";
      let attendanceClosesAt: string | null = null;
      if (row.attendance_status !== "present") {
        // A mesma conta da lista de presença: enquanto ela aceita lançamento, há o que esperar.
        const closesAt = attendanceWindowClosesAt(startsAt, endsAt);
        if (now <= closesAt) {
          status = "awaiting_attendance";
          attendanceClosesAt = closesAt.toISOString();
        } else {
          status = "attendance_not_recorded";
        }
      }

      items.push({
        registrationId: Number(row.registration_id),
        status,
        eventTitle: row.event_title,
        eventStartsAt: startsAt.toISOString(),
        eventEndsAt: endsAt ? endsAt.toISOString() : null,
        workloadHours: effectiveWorkloadHours({
          workload_hours: row.workload_hours,
          starts_at: startsAt,
          ends_at: endsAt,
        }),
        attendanceClosesAt,
        certificate: null,
      });
    }

    // Do evento mais recente para o mais antigo; o id desempata para a ordem não variar.
    items.sort(
      (a, b) =>
        Date.parse(b.eventStartsAt) - Date.parse(a.eventStartsAt) ||
        b.registrationId - a.registrationId,
    );

    // Horas certificadas: a soma do que está impresso nos certificados (RC-10).
    const certifiedHours = items.reduce(
      (sum, item) =>
        item.status === "issued" ? sum + (item.workloadHours ?? 0) : sum,
      0,
    );

    return {
      data: items,
      summary: {
        issuedCount: issued.length,
        certifiedHours: Math.round(certifiedHours * 100) / 100,
      },
    };
  }
}

// O que a verificação pública mostra: só o que está impresso no papel (RC-08) — nome completo,
// ação, organização, responsável (quando o papel o traz), período, local, carga horária e emissão.
// Nada de ids, e-mail ou PDF.
export type PublicCertificate = {
  verificationCode: string;
  participantName: string;
  eventTitle: string;
  organizerName: string;
  /** A linha "Responsável:" do rodapé; `null` quando o PDF não a imprime. */
  responsiblePersonName: string | null;
  eventStartsAt: string;
  eventEndsAt: string | null;
  eventLocationName: string | null;
  eventIsRemote: boolean;
  workloadHours: number | null;
  issuedAt: string;
};

/**
 * Verificação pública do certificado, por código (RC-08). Qualquer pessoa, sem conta, confere se o
 * documento que tem na mão existe e se os dados batem. Mostra o snapshot (RC-06), o mesmo que está
 * impresso; como não há revogação (RC-04), só há dois resultados: válido ou não encontrado.
 */
export class VerifyCertificateUseCase {
  constructor(private readonly certificates: CertificateRepository) {}

  /** `code` já normalizado pelo contrato (`certificateVerifyParamsSchema`). */
  async execute(code: string): Promise<PublicCertificate> {
    const record = await this.certificates.findByVerificationCode(code);
    if (!record) {
      throw new HttpError(
        404,
        "CERTIFICATE_NOT_FOUND",
        "Nenhum certificado foi encontrado com este código",
      );
    }

    const summary = toCertificateSummary(record);
    return {
      verificationCode: summary.verificationCode,
      participantName: record.participant_name,
      eventTitle: summary.eventTitle,
      organizerName: record.organizer_name,
      // Decisão de 18/11/2026: quem confere compara a tela com o papel, e o nome já está impresso.
      // Por isso aparece exatamente quando o PDF imprime a linha — nunca além dela.
      responsiblePersonName: printsResponsiblePerson(
        record.organizer_name,
        record.organizer_person_name,
      )
        ? record.organizer_person_name
        : null,
      eventStartsAt: summary.eventStartsAt,
      eventEndsAt: summary.eventEndsAt,
      eventLocationName: record.event_location_name,
      eventIsRemote: Boolean(record.event_is_remote),
      workloadHours: summary.workloadHours,
      issuedAt: summary.issuedAt,
    };
  }
}
