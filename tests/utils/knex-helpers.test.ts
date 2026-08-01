import assert from "node:assert/strict";
import test from "node:test";
import { isExpired, parseDbDate } from "../../src/utils/knex-helpers";

test("parseDbDate passes a Date through untouched", () => {
  const original = new Date("2026-07-28T23:46:47.403Z");
  assert.equal(parseDbDate(original).getTime(), original.getTime());
});

test("parseDbDate reads a MySQL string as UTC, not as local time", () => {
  // Shape the driver returns when `dateStrings` is on. With no timezone
  // marker, `new Date()` would assume local time: on a UTC-3 host the token
  // would live three hours longer with nothing failing.
  const fromDatabase = "2026-07-28 23:46:47.403";

  assert.equal(parseDbDate(fromDatabase).toISOString(), "2026-07-28T23:46:47.403Z");
});

test("parseDbDate does not shift a string that already carries a timezone", () => {
  for (const comFuso of [
    "2026-07-28T23:46:47.403Z",
    "2026-07-28T23:46:47.403+00:00",
    "2026-07-28T20:46:47.403-03:00",
  ]) {
    assert.equal(parseDbDate(comFuso).toISOString(), "2026-07-28T23:46:47.403Z");
  }
});

test("parseDbDate is immune to the machine timezone", () => {
  // The assertion that gives the helper its point: the result cannot depend on
  // where the app runs. Compared against Date.UTC, never against new Date().
  const expected = Date.UTC(2026, 6, 28, 23, 46, 47, 403);

  assert.equal(parseDbDate("2026-07-28 23:46:47.403").getTime(), expected);
  assert.equal(parseDbDate(new Date(expected)).getTime(), expected);
});

test("isExpired answers on both sides of the boundary", () => {
  assert.equal(isExpired(new Date(Date.now() - 60_000)), true);
  assert.equal(isExpired(new Date(Date.now() + 60_000)), false);
  assert.equal(isExpired("2020-01-01 00:00:00.000"), true);
});

test("isExpired fails CLOSED on an unparseable date", () => {
  // A naked `parsed < new Date()` yields NaN < now === false, i.e. the token
  // would be accepted. For the one check that decides whether a credential is
  // dead, the ambiguous case has to count as dead.
  for (const corrupt of ["0000-00-00 00:00:00", "nao-e-data", ""]) {
    assert.equal(isExpired(corrupt), true, `deveria expirar: ${JSON.stringify(corrupt)}`);
  }
});
