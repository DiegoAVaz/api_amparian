import assert from "node:assert/strict";
import test from "node:test";
import { renderPasswordResetEmail } from "../../src/services/mail/templates/password-reset.template";

const URL = "https://amparian.app/esqueci-minha-senha/redefinir?token=abc123";

function render(overrides: Partial<Parameters<typeof renderPasswordResetEmail>[0]> = {}) {
  return renderPasswordResetEmail({
    name: "Ana Paula Souza",
    resetUrl: URL,
    expiresInMinutes: 60,
    ...overrides,
  });
}

function validity(text: string): string | undefined {
  return text.match(/vale por (.+?) e pode/)?.[1];
}

test("renders subject, link and plain text alternative", () => {
  const mail = render();

  assert.equal(mail.subject, "Redefinição de senha — Amparian");
  assert.match(mail.text, /^Olá, Ana!/);
  assert.ok(mail.text.includes(URL), "texto puro precisa conter a URL crua");
  assert.ok(mail.html.includes(`href="${URL}"`), "HTML precisa linkar a URL");
  assert.ok(mail.text.length > 0 && mail.html.length > 0);
});

test("greets by first name and falls back when the name is blank", () => {
  assert.match(render({ name: "  " }).text, /^Olá, voluntário!/);
  assert.match(render({ name: "Zé" }).text, /^Olá, Zé!/);
});

test("escapes user-controlled name into the HTML", () => {
  const mail = render({ name: '<img src=x onerror="alert(1)"> & "Zé"' });

  assert.ok(!mail.html.includes("<img src=x"), "tag crua não pode sobreviver");
  assert.ok(!mail.html.includes('onerror="alert(1)"'));
  assert.ok(mail.html.includes("Olá, &lt;img!"));
});

test("escapes ampersands in the reset URL without corrupting it", () => {
  const withQuery = `${URL}&origem=email`;
  const mail = render({ resetUrl: withQuery });

  assert.ok(mail.html.includes(`href="${withQuery.replace(/&/g, "&amp;")}"`));
  assert.ok(mail.text.includes(withQuery), "texto puro não escapa nada");
});

test("drops URLs that are not http(s) instead of rendering them", () => {
  for (const hostile of ["javascript:alert(1)//", "data:text/html,<h1>x", "ftp://x/y"]) {
    const mail = render({ resetUrl: hostile });
    assert.ok(!mail.html.includes(hostile), `não pode renderizar ${hostile}`);
    assert.ok(!mail.text.includes(hostile));
  }
});

test("formats the expiry notice in Portuguese", () => {
  assert.equal(validity(render({ expiresInMinutes: 1 }).text), "1 minuto");
  assert.equal(validity(render({ expiresInMinutes: 30 }).text), "30 minutos");
  assert.equal(validity(render({ expiresInMinutes: 60 }).text), "1 hora");
  assert.equal(validity(render({ expiresInMinutes: 90 }).text), "1 hora e 30 minutos");
  assert.equal(validity(render({ expiresInMinutes: 120 }).text), "2 horas");
  assert.equal(validity(render({ expiresInMinutes: 0.4 }).text), "1 minuto");
});

test("degrades gracefully when the TTL is not a finite number", () => {
  // Reachable if PASSWORD_RESET_EXPIRES_IN holds a duration `ms` cannot parse.
  for (const broken of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const mail = render({ expiresInMinutes: broken });
    assert.equal(validity(mail.text), "tempo limitado");
    assert.ok(!mail.text.includes("NaN") && !mail.text.includes("Infinity"));
    assert.ok(!mail.html.includes("NaN") && !mail.html.includes("Infinity"));
  }
});
