export function firstCount(rows: unknown): number {
  const r = rows as Array<{ count: string | number }>;
  return Number(r[0]?.count ?? 0);
}
