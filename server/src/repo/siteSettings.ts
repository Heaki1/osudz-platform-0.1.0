// site_settings table access, and the submission rules that read it.
//
// docs/todo.txt C8 and C9, both surfaced by the C7 admin-tab audit. my_plan.txt requires
// administrator-defined star and length limits and allowed statuses, and editable mod and
// challenge-type lists; before this, the only rule in the server was the hardcoded
// SUBMITTABLE_STATUSES in services/osu.ts, and the submit path never looked at stars or
// length at all. Two admin tabs promised configuration that did not exist.
//
// ONE ROW, id = 1, decided 2026-09-05 — global rather than per-round. Migration 011 seeds it
// from the constants that were hardcoded, so applying it changed nothing until an
// administrator writes to the tab.
//
// Cached and invalidated on write, the same shape and reasoning as repo/allowedCountries.ts:
// these are read on every lookup and every submit to answer a question that changes when an
// administrator clicks Save.

import { pool } from '../db.js';
import { SUBMITTABLE_STATUSES } from '../services/osu.js';

interface SiteSettingsRow {
  min_stars: string | null;
  max_stars: string | null;
  min_length_seconds: number | null;
  max_length_seconds: number | null;
  allowed_statuses: string[];
  allowed_mods: string[];
  allowed_challenge_types: string[];
  updated_by: number | null;
  updated_at: Date;
}

/** The settings, with numeric columns already converted. Mirrors ApiSiteSettings. */
export interface SiteSettings {
  minStars: number | null;
  maxStars: number | null;
  minLengthSeconds: number | null;
  maxLengthSeconds: number | null;
  allowedStatuses: string[];
  allowedMods: string[];
  allowedChallengeTypes: string[];
  updatedBy: number | null;
  updatedAt: string;
}

const COLUMNS = `min_stars, max_stars, min_length_seconds, max_length_seconds,
                 allowed_statuses, allowed_mods, allowed_challenge_types,
                 updated_by, updated_at`;

/** numeric comes back from node-postgres as a string, to avoid silent precision loss. */
const asNumber = (value: string | null): number | null => (value === null ? null : Number(value));

function toSettings(row: SiteSettingsRow): SiteSettings {
  return {
    minStars: asNumber(row.min_stars),
    maxStars: asNumber(row.max_stars),
    minLengthSeconds: row.min_length_seconds,
    maxLengthSeconds: row.max_length_seconds,
    allowedStatuses: row.allowed_statuses,
    allowedMods: row.allowed_mods,
    allowedChallengeTypes: row.allowed_challenge_types,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
  };
}

let cached: SiteSettings | null = null;

export const invalidate = (): void => {
  cached = null;
};

/**
 * The settings. Throws when the row is missing rather than inventing defaults: 011 seeds it,
 * so an absent row means the migration did not run, and silently substituting "no limits"
 * would let a submission through that an administrator had configured away.
 */
export async function settings(): Promise<SiteSettings> {
  if (cached !== null) return cached;

  const { rows } = await pool.query<SiteSettingsRow>(
    `SELECT ${COLUMNS} FROM site_settings WHERE id = 1`
  );
  if (!rows[0]) throw new Error('site_settings has no row 1 — migration 011 has not been applied');

  cached = toSettings(rows[0]);
  return cached;
}

/** A patch. Every field optional; only what is present is written. */
export interface SiteSettingsPatch {
  minStars?: number | null;
  maxStars?: number | null;
  minLengthSeconds?: number | null;
  maxLengthSeconds?: number | null;
  allowedStatuses?: string[];
  allowedMods?: string[];
  allowedChallengeTypes?: string[];
}

const PATCH_COLUMNS: Record<keyof SiteSettingsPatch, string> = {
  minStars: 'min_stars',
  maxStars: 'max_stars',
  minLengthSeconds: 'min_length_seconds',
  maxLengthSeconds: 'max_length_seconds',
  allowedStatuses: 'allowed_statuses',
  allowedMods: 'allowed_mods',
  allowedChallengeTypes: 'allowed_challenge_types',
};

/**
 * Writes the fields the caller sent, and only those.
 *
 * A patch rather than a replace because the `rules` and `challenge` tabs each own part of this
 * row: a full replace would mean saving the star limits silently rewrote the mod list with
 * whatever that tab last happened to render.
 */
export async function update(patch: SiteSettingsPatch, adminId: number): Promise<SiteSettings> {
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof SiteSettingsPatch, string][]) {
    if (patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(`${column} = $${values.length}`);
  }

  values.push(adminId);
  sets.push(`updated_by = $${values.length}`, 'updated_at = now()');

  const { rows } = await pool.query<SiteSettingsRow>(
    `UPDATE site_settings SET ${sets.join(', ')} WHERE id = 1 RETURNING ${COLUMNS}`,
    values
  );
  if (!rows[0]) throw new Error('site_settings has no row 1 — migration 011 has not been applied');

  invalidate();
  return toSettings(rows[0]);
}

/** "1:03" from raw seconds, for a refusal a player can read against the osu! page. */
const formatLength = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The first rule this beatmap breaks, as a sentence, or null when it breaks none.
 *
 * PURE, and it takes the settings rather than reading them, for the same reason isEligible
 * does: the lookup preview and the submit path both call it, so a player is told before they
 * choose their requirements rather than after, and the two answers cannot drift. It also
 * makes the rules testable without a database.
 *
 * One sentence rather than a list, because the player fixes one thing at a time and a wall of
 * refusals reads as a rejection rather than as instructions.
 */
export function checkBeatmapRules(
  beatmap: { stars: number; lengthSeconds: number; mapStatus: string },
  rules: Pick<SiteSettings, 'minStars' | 'maxStars' | 'minLengthSeconds' | 'maxLengthSeconds' | 'allowedStatuses'>
): string | null {
  if (!rules.allowedStatuses.includes(beatmap.mapStatus)) {
    const allowed = rules.allowedStatuses.map((s) => s[0].toUpperCase() + s.slice(1)).join(', ');
    return allowed
      ? `This beatmap is ${beatmap.mapStatus || 'of an unknown status'}. Only ${allowed} beatmaps can be submitted this round.`
      : 'No beatmap status is currently accepted for submission.';
  }

  if (rules.minStars !== null && beatmap.stars < rules.minStars) {
    return `This beatmap is ${beatmap.stars.toFixed(2)}★, below the ${rules.minStars.toFixed(2)}★ minimum.`;
  }
  if (rules.maxStars !== null && beatmap.stars > rules.maxStars) {
    return `This beatmap is ${beatmap.stars.toFixed(2)}★, above the ${rules.maxStars.toFixed(2)}★ maximum.`;
  }

  if (rules.minLengthSeconds !== null && beatmap.lengthSeconds < rules.minLengthSeconds) {
    return `This beatmap is ${formatLength(beatmap.lengthSeconds)} long, under the ${formatLength(rules.minLengthSeconds)} minimum.`;
  }
  if (rules.maxLengthSeconds !== null && beatmap.lengthSeconds > rules.maxLengthSeconds) {
    return `This beatmap is ${formatLength(beatmap.lengthSeconds)} long, over the ${formatLength(rules.maxLengthSeconds)} maximum.`;
  }

  return null;
}

/**
 * Statuses an administrator may choose from. Narrowing within SUBMITTABLE_STATUSES only:
 * widening past it would also need the submissions_map_status_valid CHECK changed, so the row
 * would be refused after the lookup had already allowed it.
 */
export const CONFIGURABLE_STATUSES = SUBMITTABLE_STATUSES;
