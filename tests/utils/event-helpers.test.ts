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
});

test("an overnight event ending by 6h the next morning counts as one day", () => {
  // 22h às 2h em Brasília: uma noite de trabalho, com a duração como carga (decisão de 17/11/2026).
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-09T01:00:00.000Z", ends_at: "2026-11-09T05:00:00.000Z" }),
    4,
  );
  // 20h à 0h em Brasília.
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-08T23:00:00.000Z", ends_at: "2026-11-09T03:00:00.000Z" }),
    4,
  );
  // 23h às 6h em ponto: o limite da madrugada ainda vale.
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-09T02:00:00.000Z", ends_at: "2026-11-09T09:00:00.000Z" }),
    7,
  );
});

test("an event that runs into the next morning, or past 24h, is multi-day", () => {
  // 20h às 6h01: passou da madrugada.
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-08T23:00:00.000Z", ends_at: "2026-11-09T09:01:00.000Z" }),
    null,
  );
  // 3h às 4h do dia seguinte: termina na madrugada, mas dura 25h.
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-08T06:00:00.000Z", ends_at: "2026-11-09T07:00:00.000Z" }),
    null,
  );
  // 20h às 2h, dois dias depois.
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2026-11-08T23:00:00.000Z", ends_at: "2026-11-10T05:00:00.000Z" }),
    null,
  );
});

test("month and year boundaries still find the next day", () => {
  // 22h de 31/12 às 2h de 1º/1, em Brasília.
  assert.equal(
    effectiveWorkloadHours({ workload_hours: null, starts_at: "2027-01-01T01:00:00.000Z", ends_at: "2027-01-01T05:00:00.000Z" }),
    4,
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
