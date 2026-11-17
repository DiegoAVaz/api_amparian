import assert from "node:assert/strict";
import test from "node:test";
import { effectiveWorkloadHours } from "../../src/utils/event-helpers";

// RC-03: informada vence; senão duração em evento de um dia (horário de Brasília); senão nula.
// As datas abaixo estão em UTC, como no banco; Brasília é UTC-3.

test("informed workload wins, on any kind of event", () => {
  assert.equal(
    effectiveWorkloadHours({ workload_hours: "12.00", starts_at: "2026-11-06T12:00:00.000Z", ends_at: "2026-11-08T21:00:00.000Z" }),
    12,
  );
  assert.equal(
    effectiveWorkloadHours({ workload_hours: 2.5, starts_at: "2026-11-08T11:00:00.000Z", ends_at: "2026-11-08T21:00:00.000Z" }),
    2.5,
  );
});

test("one-day event without informed workload uses its duration", () => {
  // 8h30 às 12h em Brasília.
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-08T11:30:00.000Z", ends_at: "2026-11-08T15:00:00.000Z" }),
    3.5,
  );
});

test("same day is measured in Brasília time, not UTC", () => {
  // 20h às 23h em Brasília: atravessa a meia-noite em UTC, mas é um dia só para quem participou.
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-08T23:00:00.000Z", ends_at: "2026-11-09T02:00:00.000Z" }),
    3,
  );
  // 22h às 2h em Brasília: vira a noite, são dois dias — sem carga calculada.
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-09T01:00:00.000Z", ends_at: "2026-11-09T05:00:00.000Z" }),
    null,
  );
});

test("multi-day or open-ended event without informed workload has no hours", () => {
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-06T12:00:00.000Z", ends_at: "2026-11-08T21:00:00.000Z" }),
    null,
  );
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-08T11:00:00.000Z", ends_at: null }),
    null,
  );
});

test("inconsistent dates never produce hours", () => {
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-08T15:00:00.000Z", ends_at: "2026-11-08T11:00:00.000Z" }),
    null,
  );
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "data inválida", ends_at: "2026-11-08T11:00:00.000Z" }),
    null,
  );
});
