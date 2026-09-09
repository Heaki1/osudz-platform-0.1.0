// allowed_countries table access, and the cache the eligibility read goes through.
//
// docs/todo.txt C4. This replaces ELIGIBLE_COUNTRY — the single hardcoded 'DZ' that used
// to be the entire rule — with a table an administrator edits. Migration 005 seeds DZ, so
// a fresh database starts out saying exactly what the constant said.
//
// WHY A CACHE. The eligibility rule is read on every gated write and on every
// GET /auth/me, so an uncached read would put a query in front of all of them to answer a
// question whose answer changes when an administrator clicks a toggle — a handful of times
// a year. The cache is a module-level Set dropped on every write here, the same shape and
// the same reasoning as middleware/rateLimit.ts: this API is one process, so one Set is
// enough, and a restart simply reloads from the table.

import { pool } from '../db.js';

export interface AllowedCountryRow {
  country: string;
  enabled: boolean;
  added_by: number | null;
  added_at: Date;
}

const COLUMNS = 'country, enabled, added_by, added_at';

/**
 * Normalised the way isEligible normalises a profile country. country is char(2) and
 * Postgres blank-pads char, so a value read back is 'DZ' but a value read back from a
 * one-character insert would be 'X '.
 */
export const normalise = (code: string): string => code.trim().toUpperCase();

/** Exactly two ASCII letters — ISO 3166-1 alpha-2, which is what users.country_code is. */
export const isCountryCode = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim());

let cached: Set<string> | null = null;

/** Drops the cache. Every write in this file calls it. */
export const invalidate = (): void => {
  cached = null;
};

/**
 * The enabled countries.
 *
 * Throws when the table cannot be read, deliberately. Every caller already answers 503 on
 * a database failure, and falling back to a hardcoded 'DZ' would mean the gate quietly
 * disagreeing with the table an administrator had just edited — which is the exact class
 * of bug this item exists to remove.
 */
export async function enabledSet(): Promise<ReadonlySet<string>> {
  if (cached !== null) return cached;

  const { rows } = await pool.query<{ country: string }>(
    'SELECT country FROM allowed_countries WHERE enabled = true'
  );
  cached = new Set(rows.map((row) => normalise(row.country)));
  return cached;
}

/** Every row, enabled or not, for the admin tab. Disabled rows are kept on purpose. */
export async function listAll(): Promise<AllowedCountryRow[]> {
  const { rows } = await pool.query<AllowedCountryRow>(
    `SELECT ${COLUMNS} FROM allowed_countries ORDER BY country`
  );
  return rows;
}

/**
 * Adds a country or flips one that already exists.
 *
 * Toggling off keeps the row rather than deleting it: a disabled row records that an
 * administrator considered the country and refused it, which an absent row does not say.
 * added_by is refreshed on every write, so it names whoever last changed the decision
 * rather than whoever first typed the code.
 */
export async function setEnabled(
  code: string,
  enabled: boolean,
  adminId: number
): Promise<AllowedCountryRow> {
  const { rows } = await pool.query<AllowedCountryRow>(
    `INSERT INTO allowed_countries (country, enabled, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (country) DO UPDATE SET
       enabled  = EXCLUDED.enabled,
       added_by = EXCLUDED.added_by,
       added_at = now()
     RETURNING ${COLUMNS}`,
    [normalise(code), enabled, adminId]
  );
  invalidate();
  return rows[0];
}

/**
 * Removes a row outright. Distinct from disabling it: this is for a code typed by mistake,
 * where leaving a disabled 'XZ' in the list would be noise rather than a record of a
 * decision. Reports whether a row actually went, so removing nothing answers 404.
 */
export async function remove(code: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM allowed_countries WHERE country = $1', [
    normalise(code),
  ]);
  invalidate();
  return (rowCount ?? 0) > 0;
}

/** Maps a row to the ApiAllowedCountry DTO in src/api/client.ts. */
export function toApiAllowedCountry(row: AllowedCountryRow) {
  return {
    country: normalise(row.country),
    enabled: row.enabled,
    addedBy: row.added_by,
    addedAt: row.added_at.toISOString(),
  };
}
