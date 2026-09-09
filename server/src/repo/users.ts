// users table access.
//
// Note on osu_id: the column is bigint, and node-postgres returns bigint as a
// string to avoid silent precision loss. Every read therefore converts
// explicitly — do not assume row.osu_id is a number.

import { pool } from '../db.js';
import { env } from '../env.js';
import type { OsuMe } from '../services/osu.js';

export interface UserRow {
  id: number;
  osu_id: string;
  username: string;
  country_code: string;
  avatar_url: string | null;
  global_rank: number | null;
  is_admin: boolean;
  /**
   * Revocation epoch (G6). Sealed into the session cookie and compared on every
   * authenticated request, so incrementing it invalidates every cookie this account holds.
   */
  session_epoch: number;
}

const COLUMNS =
  'id, osu_id, username, country_code, avatar_url, global_rank, is_admin, session_epoch';

/**
 * Whether this account may submit and vote. docs/my_plan.txt: players from the
 * community's countries may submit and vote, everyone else may read and comment.
 *
 * The rule lives here, beside toApiUser, so that middleware/auth.ts's gate and the
 * canVote flag the client reads are the same sentence rather than two copies that
 * drift. country_code is char(2) and Postgres blank-pads it, hence the trim.
 *
 * TAKES THE ALLOWLIST RATHER THAN READING IT (C4). The countries live in a table now,
 * but this stays a pure function of a row and a set: the two callers each load the set
 * once — through the cache in repo/allowedCountries.ts — and neither of them turns
 * async in a place where it would have to await inside a render or a map. Passing it in
 * is also what keeps this testable without a database.
 *
 * Administrator-granted per-player exceptions (C5) layer on top of this through
 * canParticipate; this function stays the COUNTRY rule and nothing else.
 */
export const isEligible = (row: UserRow, allowedCountries: ReadonlySet<string>): boolean =>
  allowedCountries.has(row.country_code.trim().toUpperCase());

/** The two things an administrator controls independently (C5). */
export type Capability = 'submit' | 'vote';

/**
 * A per-player override, as much of one as the rule needs. Structural rather than an
 * import of ParticipantPermissionRow, so this file stays testable without a database and
 * the two modules do not need each other at runtime.
 *
 * THREE-VALUED, and that is the whole point: null means "no override for this capability",
 * so blocking someone from voting says nothing at all about whether they may submit.
 */
export interface CapabilityOverride {
  can_submit: boolean | null;
  can_vote: boolean | null;
}

/**
 * Whether an account may use one capability: the administrator's override for that
 * capability if there is one, otherwise the country rule.
 *
 * An override wins in BOTH directions — it can refuse a player the country rule allows,
 * and grant one it refuses. That is C5's decision, and it is why this cannot be written as
 * "country rule AND not blocked".
 */
export function canParticipate(
  capability: Capability,
  row: UserRow,
  allowedCountries: ReadonlySet<string>,
  override: CapabilityOverride | null
): boolean {
  const explicit = capability === 'submit' ? override?.can_submit : override?.can_vote;
  if (explicit === true || explicit === false) return explicit;
  return isEligible(row, allowedCountries);
}

/**
 * Whether an account may compete in the CHALLENGE.
 *
 * The country rule decides by default, exactly as it did before C5 split submitting from
 * voting (docs/todo.txt E2): the challenge is for the same community as the rest of the
 * platform, so accounts outside the enabled countries read the leaderboard and comment but
 * do not compete for the prize.
 *
 * AN UNAMBIGUOUS OVERRIDE DECIDES INSTEAD, in both directions. Blocked from submitting AND
 * voting is the only way the two capabilities an administrator actually sets can say "this
 * account does not take part", so it blocks the challenge too — an investigation that
 * removed every other form of participation but left the player eligible to win the month's
 * prize would be a hole, not a policy. Granted both is that statement inverted, so it grants
 * the challenge.
 *
 * A PARTIAL OVERRIDE LEAVES THE CHALLENGE TO THE COUNTRY RULE. "No submitting for a month"
 * after a troll entry says nothing about playing the winning map, and reading it as a
 * challenge ban would invent a rule the administrator did not set.
 *
 * Deliberately NOT canParticipate('submit') && canParticipate('vote'), which would turn
 * every partial block into a challenge ban. And deliberately no can_challenge column and no
 * third Capability: the rule is DERIVED from the two that are stored, so there is nothing
 * extra to keep in sync and no migration behind a policy that may yet be tuned.
 */
export function canEnterChallenge(
  row: UserRow,
  allowedCountries: ReadonlySet<string>,
  override: CapabilityOverride | null
): boolean {
  if (override?.can_submit === false && override?.can_vote === false) return false;
  if (override?.can_submit === true && override?.can_vote === true) return true;
  return isEligible(row, allowedCountries);
}

/**
 * Creates the user on first login and refreshes the mutable fields on every
 * later login. Admin status is derived from ADMIN_OSU_IDS each time, so granting
 * or revoking admin is an env change plus a re-login, not a manual UPDATE.
 */
export async function upsertFromOsu(me: OsuMe): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (osu_id, username, country_code, avatar_url, global_rank, is_admin)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (osu_id) DO UPDATE SET
       username     = EXCLUDED.username,
       country_code = EXCLUDED.country_code,
       avatar_url   = EXCLUDED.avatar_url,
       global_rank  = EXCLUDED.global_rank,
       is_admin     = EXCLUDED.is_admin,
       updated_at   = now()
     RETURNING ${COLUMNS}`,
    [
      me.id,
      me.username,
      me.country_code,
      me.avatar_url ?? null,
      me.statistics?.global_rank ?? null,
      env.adminOsuIds.includes(me.id),
    ]
  );
  return rows[0];
}

/**
 * By internal id, for the admin routes that address an account by the id the client
 * already has. Distinct from findByOsuId, which is the login path's lookup.
 */
export async function findById(id: number): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findByOsuId(osuId: number): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE osu_id = $1`,
    [osuId]
  );
  return rows[0] ?? null;
}

/**
 * Maps a row to the ApiUser DTO declared in src/api/client.ts.
 *
 * Takes the allowlist and the override for the same reason canParticipate does: the flags
 * the client reads and the gates that refuse the writes have to be the same sentence, so
 * they resolve through the same function rather than two copies that drift.
 */
export function toApiUser(
  row: UserRow,
  allowedCountries: ReadonlySet<string>,
  override: CapabilityOverride | null = null
) {
  return {
    id: row.id,
    osuId: Number(row.osu_id),
    username: row.username,
    country: row.country_code.trim(),
    avatarUrl: row.avatar_url ?? '',
    globalRank: row.global_rank,
    isAdmin: row.is_admin,
    canVote: canParticipate('vote', row, allowedCountries, override),
    canSubmit: canParticipate('submit', row, allowedCountries, override),
    canChallenge: canEnterChallenge(row, allowedCountries, override),
  };
}

/**
 * A user row with whatever override applies to it, for the admin Users tab.
 *
 * LEFT JOIN, not an inner one: the tab shows the whole roster, and most accounts have no
 * override at all — an inner join would quietly render only the exceptions.
 */
export interface UserWithOverrideRow extends UserRow, CapabilityOverride {
  note: string | null;
  set_by: number | null;
  set_at: Date | null;
}

export async function listAllWithOverrides(): Promise<UserWithOverrideRow[]> {
  const { rows } = await pool.query<UserWithOverrideRow>(
    `SELECT u.id, u.osu_id, u.username, u.country_code, u.avatar_url, u.global_rank,
            u.is_admin,
            p.can_submit, p.can_vote, p.note, p.set_by, p.set_at
       FROM users u
       LEFT JOIN participant_permissions p ON p.user_id = u.id
      ORDER BY u.username`
  );
  return rows;
}

/** Whether a joined row actually carries an override, as opposed to all-null columns. */
export const hasOverride = (row: UserWithOverrideRow): boolean =>
  row.set_at !== null;

/**
 * Maps a joined roster row to the ApiAdminUser DTO in src/api/client.ts.
 *
 * canSubmit and canVote are the EFFECTIVE answers — what the gates would actually decide —
 * resolved through canParticipate, while `override` carries the raw three-valued row so the
 * admin tab can show the difference between "granted" and "the country rule already allows
 * it". Sending only one of the two would make the tab either lie or guess.
 */
export function toApiAdminUser(row: UserWithOverrideRow, allowedCountries: ReadonlySet<string>) {
  return {
    id: row.id,
    osuId: Number(row.osu_id),
    username: row.username,
    country: row.country_code.trim(),
    avatarUrl: row.avatar_url ?? '',
    globalRank: row.global_rank,
    isAdmin: row.is_admin,
    canSubmit: canParticipate('submit', row, allowedCountries, row),
    canVote: canParticipate('vote', row, allowedCountries, row),
    canChallenge: canEnterChallenge(row, allowedCountries, row),
    countryAllowed: isEligible(row, allowedCountries),
    override: hasOverride(row)
      ? {
          canSubmit: row.can_submit,
          canVote: row.can_vote,
          note: row.note,
          setBy: row.set_by,
          setAt: row.set_at?.toISOString() ?? null,
        }
      : null,
  };
}

/**
 * Ends every session this account holds (G6), by moving its revocation epoch past whatever
 * the cookies in circulation were sealed with.
 *
 * Returns the new epoch, so the caller revoking their OWN sessions can be handed a fresh
 * cookie in the same response instead of being signed out of the tab they clicked in.
 */
export async function revokeSessions(userId: number): Promise<number | null> {
  const { rows } = await pool.query<{ session_epoch: number }>(
    'UPDATE users SET session_epoch = session_epoch + 1 WHERE id = $1 RETURNING session_epoch',
    [userId]
  );
  return rows[0]?.session_epoch ?? null;
}
