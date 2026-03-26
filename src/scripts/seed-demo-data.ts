import bcrypt from "bcrypt";
import { db } from "../db/knex";

type DemoUserInput = {
  email: string;
  name: string;
  phone: string;
  city: string;
  state: string;
  bio: string;
  publicOrganizationName?: string | null;
  avatarUrl?: string | null;
};

type DemoEventInput = {
  organizerEmail: string;
  title: string;
  summary: string;
  description: string;
  rulesTerms: string;
  startsAt: Date;
  endsAt: Date | null;
  locationName: string;
  isRemote: boolean;
  capacity: number | null;
  highlightSkill: string;
  coverImageUrl: string | null;
  typeCodes: string[];
  requirementCodes: string[];
};

const DEMO_PASSWORD = "123456";

const DEMO_USERS: DemoUserInput[] = [
  {
    email: "marina.organizadora@amparian.demo",
    name: "Marina Costa",
    phone: "21999990001",
    city: "Rio de Janeiro",
    state: "RJ",
    bio: "Organizadora de ações ambientais e mutirões comunitários.",
    publicOrganizationName: "Instituto Verde Vivo",
  },
  {
    email: "renato.organizador@amparian.demo",
    name: "Renato Almeida",
    phone: "21999990002",
    city: "Niterói",
    state: "RJ",
    bio: "Promove ações sociais focadas em educação e inclusão.",
    publicOrganizationName: "Rede Futuro Coletivo",
  },
  {
    email: "diego.participante@amparian.demo",
    name: "Diego Ferreira",
    phone: "21999990003",
    city: "São Gonçalo",
    state: "RJ",
    bio: "Voluntário interessado em causas ambientais e educação.",
  },
  {
    email: "ana.participante@amparian.demo",
    name: "Ana Paula Silva",
    phone: "21999990004",
    city: "Duque de Caxias",
    state: "RJ",
    bio: "Designer e voluntária em projetos comunitários.",
  },
];

function daysFromNow(days: number, hour: number, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

const DEMO_EVENTS: DemoEventInput[] = [
  {
    organizerEmail: "marina.organizadora@amparian.demo",
    title: "Mutirão de limpeza na Praia de Icaraí",
    summary: "Ação coletiva para limpeza da faixa de areia e separação de recicláveis.",
    description:
      "Vamos reunir voluntários para limpar a praia, orientar banhistas e encaminhar resíduos para reciclagem.",
    rulesTerms:
      "Use roupas leves, leve garrafa de água e utilize calçado apropriado para caminhada na areia.",
    startsAt: daysFromNow(5, 8, 30),
    endsAt: daysFromNow(5, 12, 0),
    locationName: "Praia de Icaraí, Niterói",
    isRemote: false,
    capacity: 30,
    highlightSkill: "Consciência ambiental",
    coverImageUrl: null,
    typeCodes: ["limpeza", "educacao"],
    requirementCodes: ["age_18", "physical_effort"],
  },
  {
    organizerEmail: "renato.organizador@amparian.demo",
    title: "Oficina de currículo para jovens",
    summary: "Encontro para revisar currículos e orientar jovens em busca do primeiro emprego.",
    description:
      "A oficina será realizada em formato de mentorias curtas, com apoio para currículo, apresentação pessoal e networking.",
    rulesTerms:
      "Chegue com 15 minutos de antecedência. Se possível, leve notebook ou celular com acesso ao e-mail.",
    startsAt: daysFromNow(8, 14, 0),
    endsAt: daysFromNow(8, 17, 0),
    locationName: "Centro Comunitário Futuro Coletivo",
    isRemote: false,
    capacity: 20,
    highlightSkill: "Mentoria",
    coverImageUrl: null,
    typeCodes: ["educacao", "trabalho_administrativo"],
    requirementCodes: ["own_device"],
  },
  {
    organizerEmail: "marina.organizadora@amparian.demo",
    title: "Campanha remota de arrecadação de doações",
    summary: "Mobilização online para apoiar famílias atendidas pela ONG com itens básicos.",
    description:
      "Os voluntários vão ajudar na divulgação digital, organização de contatos e apoio ao fluxo de arrecadação.",
    rulesTerms:
      "É importante ter disponibilidade para responder mensagens e registrar contatos em planilha compartilhada.",
    startsAt: daysFromNow(12, 19, 0),
    endsAt: daysFromNow(12, 21, 0),
    locationName: "Google Meet",
    isRemote: true,
    capacity: 15,
    highlightSkill: "Comunicação",
    coverImageUrl: null,
    typeCodes: ["arrecadacao", "venda_marketing"],
    requirementCodes: ["own_device"],
  },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const demoEmails = DEMO_USERS.map((user) => user.email);

  await db.transaction(async (trx) => {
    await trx("users").whereIn("email", demoEmails).delete();

    const userIdsByEmail = new Map<string, number>();
    for (const user of DEMO_USERS) {
      const inserted = await trx("users").insert({
        email: user.email,
        password_hash: passwordHash,
        name: user.name,
        phone: user.phone,
        city: user.city,
        state: user.state,
        bio: user.bio,
        public_organization_name: user.publicOrganizationName ?? null,
        avatar_url: user.avatarUrl ?? null,
        plan: "basic",
      });

      const userId = Number(Array.isArray(inserted) ? inserted[0] : inserted);
      userIdsByEmail.set(user.email, userId);
    }

    const eventTypes = await trx("event_types").select("id", "code");
    const requirements = await trx("requirement_options").select("id", "code");

    const eventTypeIdByCode = new Map<string, number>(
      eventTypes.map((row) => [String(row.code), Number(row.id)]),
    );
    const requirementIdByCode = new Map<string, number>(
      requirements.map((row) => [String(row.code), Number(row.id)]),
    );

    const eventIdsByTitle = new Map<string, number>();
    for (const event of DEMO_EVENTS) {
      const organizerId = userIdsByEmail.get(event.organizerEmail);
      if (!organizerId) {
        throw new Error(`Organizador demo não encontrado para ${event.organizerEmail}`);
      }

      const inserted = await trx("events").insert({
        organizer_id: organizerId,
        title: event.title,
        summary: event.summary,
        description: event.description,
        rules_terms: event.rulesTerms,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        location_name: event.locationName,
        is_remote: event.isRemote,
        capacity: event.capacity,
        cover_image_url: event.coverImageUrl,
        highlight_skill: event.highlightSkill,
        status: "published",
      });

      const eventId = Number(Array.isArray(inserted) ? inserted[0] : inserted);
      eventIdsByTitle.set(event.title, eventId);

      for (const typeCode of event.typeCodes) {
        const eventTypeId = eventTypeIdByCode.get(typeCode);
        if (!eventTypeId) throw new Error(`Tipo de evento não encontrado: ${typeCode}`);
        await trx("event_event_types").insert({
          event_id: eventId,
          event_type_id: eventTypeId,
        });
      }

      for (const requirementCode of event.requirementCodes) {
        const requirementId = requirementIdByCode.get(requirementCode);
        if (!requirementId) throw new Error(`Requisito não encontrado: ${requirementCode}`);
        await trx("event_requirements").insert({
          event_id: eventId,
          requirement_id: requirementId,
        });
      }
    }

    const diegoId = userIdsByEmail.get("diego.participante@amparian.demo");
    const anaId = userIdsByEmail.get("ana.participante@amparian.demo");

    if (!diegoId || !anaId) {
      throw new Error("Participantes demo não encontrados");
    }

    await trx("event_registrations").insert([
      {
        event_id: eventIdsByTitle.get("Mutirão de limpeza na Praia de Icaraí"),
        user_id: diegoId,
        status: "confirmed",
        participant_role: "Voluntário",
        agreed_responsibility_at: new Date(),
      },
      {
        event_id: eventIdsByTitle.get("Oficina de currículo para jovens"),
        user_id: anaId,
        status: "pending",
        participant_role: "Mentora",
        agreed_responsibility_at: new Date(),
      },
    ]);
  });

  console.log("Seed demo concluído.");
  console.log("Credenciais demo:");
  console.log("- Organizador 1: marina.organizadora@amparian.demo / 123456");
  console.log("- Organizador 2: renato.organizador@amparian.demo / 123456");
  console.log("- Participante 1: diego.participante@amparian.demo / 123456");
  console.log("- Participante 2: ana.participante@amparian.demo / 123456");
}

void main()
  .catch((error) => {
    console.error("Falha ao popular dados demo:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
