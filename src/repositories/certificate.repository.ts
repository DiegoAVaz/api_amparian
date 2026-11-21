import type { Knex } from "knex";
import type {
  AttendanceStatus,
  CertificateRecord,
  EventStatus,
} from "../models";

// Tudo o que a emissão precisa saber sobre uma inscrição para decidir (RC-01) e para montar o
// snapshot (RC-06), numa consulta só. Os nomes do organizador vêm dos dois campos do perfil dele:
// a organização pública, quando existe, é quem "promove" a ação.
export type IssuanceContextRow = {
  registration_id: number;
  participant_name: string;
  event_status: EventStatus;
  event_title: string;
  starts_at: Date | string;
  ends_at: Date | string | null;
  location_name: string | null;
  is_remote: boolean | number;
  workload_hours: string | null;
  organizer_name: string;
  organizer_public_name: string | null;
  attendance_status: AttendanceStatus | null;
};

// Uma inscrição do usuário que ainda pode virar certificado: confirmada, num evento publicado que
// já começou, sem certificado e sem falta registrada. Quem decide o estado dela em "Meus
// certificados" (disponível, aguardando ou sem presença) é o caso de uso.
export type CertificateCandidateRow = {
  registration_id: number;
  event_status: EventStatus;
  event_title: string;
  starts_at: Date | string;
  ends_at: Date | string | null;
  workload_hours: string | null;
  attendance_status: AttendanceStatus | null;
};

// O que o caso de uso grava. Sem `id`, `blob_key` e timestamps: são do banco, ou gravados depois.
export type CertificateInsert = Omit<
  CertificateRecord,
  "id" | "blob_key" | "created_at" | "updated_at"
>;

// O que um INSERT pode dar: a linha nova, ou qual das duas regras de unicidade barrou. As duas
// colisões pedem respostas diferentes — a da inscrição devolve o certificado que já existe (RC-05),
// a do código sorteia outro (RC-07) —, e quem as distingue é o nome do índice, que só a camada
// que fala SQL deve conhecer.
export type CertificateInsertResult =
  { ok: true; id: number } | { ok: false; conflict: "registration" | "code" };

function duplicateIndex(error: unknown): "registration" | "code" | null {
  const { code, sqlMessage } = error as {
    code?: unknown;
    sqlMessage?: unknown;
  };
  if (code !== "ER_DUP_ENTRY" || typeof sqlMessage !== "string") return null;
  if (sqlMessage.includes("uq_certificate_registration")) return "registration";
  if (sqlMessage.includes("uq_certificate_code")) return "code";
  return null;
}

export class CertificateRepository {
  constructor(private readonly db: Knex) {}

  async transaction<T>(fn: (trx: Knex) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  async findByRegistrationId(
    registrationId: number,
    db: Knex = this.db,
  ): Promise<CertificateRecord | undefined> {
    return db<CertificateRecord>("certificates")
      .where({ registration_id: registrationId })
      .first();
  }

  // Busca da verificação pública (RC-08). O código chega já normalizado pela aplicação (RC-07):
  // a consulta compara igualdade exata e não depende da collation do banco.
  async findByVerificationCode(
    code: string,
    db: Knex = this.db,
  ): Promise<CertificateRecord | undefined> {
    return db<CertificateRecord>("certificates")
      .where({ verification_code: code })
      .first();
  }

  // O certificado só aparece para o dono da inscrição. Certificado de outra pessoa e certificado
  // inexistente dão o mesmo resultado, para o id não virar um jeito de sondar emissões alheias.
  async findByIdForUser(
    certificateId: number,
    userId: number,
    db: Knex = this.db,
  ): Promise<CertificateRecord | undefined> {
    return db("certificates as c")
      .join("event_registrations as er", "er.id", "c.registration_id")
      .where("c.id", certificateId)
      .andWhere("er.user_id", userId)
      .select("c.*")
      .first();
  }

  // Trava compartilhada na linha do evento, até o fim da transação de emissão; é a primeira trava
  // dela. A edição da carga horária de evento encerrado trava a mesma linha de forma exclusiva antes
  // de conferir se já há certificado (RC-11): uma espera a outra, e o certificado nunca sai com uma
  // carga que mudou no meio da emissão. Compartilhada, e não exclusiva, para que duas emissões do
  // mesmo evento não se enfileirem entre si.
  async lockEventForIssuance(eventId: number, db: Knex): Promise<void> {
    await db("events").where({ id: eventId }).forShare().first("id");
  }

  async findIssuanceContext(
    registrationId: number,
    db: Knex = this.db,
  ): Promise<IssuanceContextRow | undefined> {
    return db("event_registrations as er")
      .join("users as participant", "participant.id", "er.user_id")
      .join("events as e", "e.id", "er.event_id")
      .join("users as organizer", "organizer.id", "e.organizer_id")
      .leftJoin("event_attendances as ea", "ea.registration_id", "er.id")
      .where("er.id", registrationId)
      .select(
        "er.id as registration_id",
        "participant.name as participant_name",
        "e.status as event_status",
        "e.title as event_title",
        "e.starts_at",
        "e.ends_at",
        "e.location_name",
        "e.is_remote",
        "e.workload_hours",
        "organizer.name as organizer_name",
        "organizer.public_organization_name as organizer_public_name",
        "ea.status as attendance_status",
      )
      .first();
  }

  async insert(
    row: CertificateInsert,
    db: Knex = this.db,
  ): Promise<CertificateInsertResult> {
    try {
      const [id] = await db("certificates").insert(row);
      return { ok: true, id: Number(id) };
    } catch (error) {
      // No InnoDB, a chave duplicada desfaz só o comando, não a transação: quem chama pode
      // sortear outro código e tentar de novo na mesma transação.
      const conflict = duplicateIndex(error);
      if (conflict) return { ok: false, conflict };
      throw error;
    }
  }

  // Grava a chave do PDF só se a linha ainda estiver com a chave esperada. Se outra requisição
  // trocou a chave nesse meio-tempo (dois downloads regenerando o mesmo PDF), esta não sobrescreve,
  // e quem chamou apaga o blob que acabou de enviar.
  async setBlobKey(
    certificateId: number,
    key: string,
    expectedKey: string | null,
    db: Knex = this.db,
  ): Promise<number> {
    const query = db("certificates").where({ id: certificateId });
    if (expectedKey === null) query.whereNull("blob_key");
    else query.andWhere({ blob_key: expectedKey });
    return query.update({ blob_key: key });
  }

  // Todos os certificados do usuário, pelo dono da inscrição. Entram mesmo os de inscrição ou evento
  // que mudaram depois: o que foi emitido é definitivo (RC-04) e mostra o snapshot (RC-06).
  async listByUser(
    userId: number,
    db: Knex = this.db,
  ): Promise<CertificateRecord[]> {
    return db("certificates as c")
      .join("event_registrations as er", "er.id", "c.registration_id")
      .where("er.user_id", userId)
      .select("c.*");
  }

  // As inscrições do usuário que ainda podem render certificado (ver `CertificateCandidateRow`).
  // Os eventos que ainda não começaram ficam de fora já aqui; se o evento terminou, o caso de uso
  // confere com `computeEventStatus`, a mesma regra da emissão. A falta registrada também fica de
  // fora: não há o que esperar (RC-01).
  async listCandidatesByUser(
    userId: number,
    now: Date,
    db: Knex = this.db,
  ): Promise<CertificateCandidateRow[]> {
    return db("event_registrations as er")
      .join("events as e", "e.id", "er.event_id")
      .leftJoin("event_attendances as ea", "ea.registration_id", "er.id")
      .leftJoin("certificates as c", "c.registration_id", "er.id")
      .where("er.user_id", userId)
      .andWhere("er.status", "confirmed")
      .andWhere("e.status", "published")
      .andWhere("e.starts_at", "<=", now)
      .whereNull("c.id")
      .andWhere((q) =>
        q.whereNull("ea.status").orWhere("ea.status", "present"),
      )
      .select(
        "er.id as registration_id",
        "e.status as event_status",
        "e.title as event_title",
        "e.starts_at",
        "e.ends_at",
        "e.workload_hours",
        "ea.status as attendance_status",
      );
  }

  // Se algum inscrito do evento já emitiu certificado. Depois da primeira emissão, a carga horária
  // do evento encerrado não muda mais (RC-11): os certificados do mesmo evento saem com a mesma carga.
  async existsForEvent(eventId: number, db: Knex = this.db): Promise<boolean> {
    const row = await db("certificates as c")
      .join("event_registrations as er", "er.id", "c.registration_id")
      .where("er.event_id", eventId)
      .first("c.id");
    return row !== undefined;
  }

  // Entre as inscrições pedidas, as que já têm certificado. É a trava de RC-04: a presença dessas
  // não muda mais.
  async findIssuedRegistrationIds(
    registrationIds: number[],
    db: Knex = this.db,
  ): Promise<number[]> {
    if (registrationIds.length === 0) return [];
    const rows: Array<{ registration_id: number }> = await db("certificates")
      .whereIn("registration_id", registrationIds)
      .select("registration_id");
    return rows.map((row) => Number(row.registration_id));
  }
}
