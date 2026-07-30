export function firstCount(rows: unknown): number {
  const r = rows as Array<{ count: string | number }>;
  return Number(r[0]?.count ?? 0);
}

/**
 * Reads a date coming from the database as UTC, always.
 *
 * With `dateStrings` off in `db/knex.ts` the driver already returns a `Date`
 * and this just passes it through. It exists in case that setting is ever
 * turned back on: the MySQL string carries no timezone marker, so `new Date()`
 * over it would assume local time. On a token expiry that means extra validity,
 * silently — nothing fails, the link merely outlives its window.
 */
export function parseDbDate(value: Date | string): Date {
  if (value instanceof Date) return value;

  const isoLike = value.includes("T") ? value : value.replace(" ", "T");
  const hasOffset = /([Zz]|[+-]\d{2}:?\d{2})$/.test(isoLike);
  return new Date(hasOffset ? isoLike : `${isoLike}Z`);
}

/**
 * Whether a stored expiry has passed.
 *
 * Fails CLOSED on an unparseable value: `NaN < now` is `false`, so a naked
 * comparison would treat a corrupt date as still valid. This is the one check
 * whose entire job is deciding whether a credential is dead, so the ambiguous
 * case must count as dead.
 */
export function isExpired(expiresAt: Date | string): boolean {
  const parsed = parseDbDate(expiresAt);
  return Number.isNaN(parsed.getTime()) || parsed < new Date();
}
