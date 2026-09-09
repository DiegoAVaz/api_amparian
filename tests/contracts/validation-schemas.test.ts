import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emailBoundarySchema,
  registerBodySchema,
  resetPasswordBodySchema,
} from "../../src/contracts/auth.contract";
import {
  eventRegistrationBodySchema,
  publicEventIdParamsSchema,
  publicEventsListQuerySchema,
} from "../../src/contracts/events.contract";
import {
  createEventBodySchema,
  meProfilePatchBodySchema,
  patchEventBodySchema,
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
  assert.equal(
    updateOrganizerRegistrationBodySchema.safeParse({ status: "approved" }).success,
    false,
  );
});
