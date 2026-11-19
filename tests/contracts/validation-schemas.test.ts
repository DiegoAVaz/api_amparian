import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emailBoundarySchema,
  registerBodySchema,
  resetPasswordBodySchema,
} from "../../src/contracts/auth.contract";
import {
  certificateIdParamsSchema,
  certificateVerifyParamsSchema,
} from "../../src/contracts/certificates.contract";
import {
  eventRegistrationBodySchema,
  publicEventIdParamsSchema,
  publicEventsListQuerySchema,
} from "../../src/contracts/events.contract";
import {
  ATTENDANCE_BATCH_MAX,
  createEventBodySchema,
  meProfilePatchBodySchema,
  patchEventBodySchema,
  recordAttendanceBodySchema,
  updateOrganizerRegistrationBodySchema,
} from "../../src/contracts/me.contract";

test("auth schemas normalize email and register phone", () => {
  assert.equal(emailBoundarySchema.parse(" USER@EXAMPLE.COM "), "user@example.com");

  const formattedPhone = registerBodySchema.parse({
    email: "user@example.com",
    password: "Senha@123",
    name: "Usuario Teste",
    phone: "(11) 99999-9999",
  });
  assert.equal(formattedPhone.phone, "11999999999");

  const emptyPhone = registerBodySchema.parse({
    email: "empty@example.com",
    password: "Senha@123",
    name: "Usuario Teste",
    phone: "",
  });
  assert.equal(emptyPhone.phone, undefined);

  assert.equal(
    registerBodySchema.safeParse({
      email: "bad-phone@example.com",
      password: "Senha@123",
      name: "Usuario Teste",
      phone: "+55 (11) 99999-9999",
    }).success,
    false,
  );
});

test("reset password schema rejects weak payloads", () => {
  assert.equal(
    resetPasswordBodySchema.safeParse({
      token: "",
      newPassword: "fraca",
    }).success,
    false,
  );
});

// `avatarUrl` saiu deste schema no api-3: a foto de perfil passou a chegar por
// upload, em rota própria. Aceitá-la aqui deixaria o salvamento do perfil
// sobrescrever a chave do blob pela URL, órfanando o arquivo.
test("profile patch normalizes nullable fields", () => {
  const profile = meProfilePatchBodySchema.parse({
    phone: "11 99999 9999",
    state: "sp",
  });

  assert.equal(profile.phone, "11999999999");
  assert.equal(profile.state, "SP");

  const empty = meProfilePatchBodySchema.parse({ phone: "" });
  assert.equal(empty.phone, null);
});

test("profile patch strips avatarUrl, which is no longer part of the contract", () => {
  const resultado = meProfilePatchBodySchema.parse({
    phone: "11999999999",
    avatarUrl: "https://example.com/avatar.png",
  });
  assert.ok(
    !("avatarUrl" in resultado),
    "avatarUrl não pode atravessar a validação",
  );
});

test("public event schemas keep contract errors as invalid requests", () => {
  assert.deepEqual(publicEventsListQuerySchema.parse({ q: "   " }), {
    q: undefined,
    page: 1,
    limit: 20,
  });

  assert.equal(publicEventIdParamsSchema.safeParse({ eventId: "-1" }).success, false);
  assert.equal(
    eventRegistrationBodySchema.safeParse({
      participantRole: 123,
      agreedResponsibility: true,
    }).success,
    false,
  );
  assert.equal(
    eventRegistrationBodySchema.safeParse({
      participantRole: "apoio",
      agreedResponsibility: false,
    }).success,
    false,
  );
});

test("organizer event schemas reject invalid closed-domain values", () => {
  assert.equal(
    createEventBodySchema.safeParse({
      title: "Evento",
      summary: "Resumo",
      startsAt: "2026-05-02T10:00:00.000Z",
      endsAt: "2026-05-02T09:00:00.000Z",
      isRemote: true,
      typeCodes: ["education"],
      requirementCodes: [],
      publish: false,
    }).success,
    false,
  );

  assert.equal(patchEventBodySchema.safeParse({}).success, false);

  // Carga horária (RC-03): maior que 0, até 500, no máximo duas casas decimais, e pode ser nula.
  for (const invalid of [0, -1, 500.01, 2.555, "4"]) {
    assert.equal(
      patchEventBodySchema.safeParse({ workloadHours: invalid }).success,
      false,
      `workloadHours ${String(invalid)} deveria ser recusada`,
    );
  }
  // Lote de presença: de 1 até ATTENDANCE_BATCH_MAX itens, status fechado.
  assert.equal(recordAttendanceBodySchema.safeParse({ items: [] }).success, false);
  assert.equal(
    recordAttendanceBodySchema.safeParse({ items: [{ registrationId: 1, status: "late" }] }).success,
    false,
  );
  assert.equal(
    recordAttendanceBodySchema.safeParse({
      items: Array.from({ length: ATTENDANCE_BATCH_MAX + 1 }, (_, i) => ({ registrationId: i + 1, status: "present" })),
    }).success,
    false,
  );
  assert.equal(
    recordAttendanceBodySchema.safeParse({
      items: [
        { registrationId: 1, status: "present" },
        { registrationId: 2, status: "absent" },
      ],
    }).success,
    true,
  );

  for (const valid of [0.5, 2.5, 4, 500, null]) {
    assert.equal(
      patchEventBodySchema.safeParse({ workloadHours: valid }).success,
      true,
      `workloadHours ${String(valid)} deveria ser aceita`,
    );
  }
  assert.equal(
    updateOrganizerRegistrationBodySchema.safeParse({ status: "approved" }).success,
    false,
  );
});

test("certificate verify code is normalized before reaching the use case (RC-07)", () => {
  // Como alguém digita ou lê do papel: minúsculas, hífens, espaços.
  for (const typed of ["r4wt-8hzn-2qkc", "R4WT8HZN2QKC", " R4WT 8HZN 2QKC "]) {
    assert.deepEqual(certificateVerifyParamsSchema.parse({ code: typed }), {
      code: "R4WT8HZN2QKC",
    });
  }

  // 0, 1, I e O não existem no alfabeto; tamanho errado também não é código.
  for (const invalid of ["R4WT-8HZN-2QK0", "R4WT-8HZN-2QKI", "R4WT-8HZN-2QK", "R4WT-8HZN-2QKCX", "", "x".repeat(65)]) {
    const result = certificateVerifyParamsSchema.safeParse({ code: invalid });
    assert.equal(result.success, false, invalid);
  }
});

test("certificate id param rejects non-positive ids with a Portuguese message", () => {
  assert.deepEqual(certificateIdParamsSchema.parse({ certificateId: "12" }), {
    certificateId: 12,
  });
  const result = certificateIdParamsSchema.safeParse({ certificateId: "0" });
  assert.equal(result.success, false);
  assert.equal(
    result.error?.issues[0]?.message,
    "O ID do certificado deve ser maior que 0",
  );
});
