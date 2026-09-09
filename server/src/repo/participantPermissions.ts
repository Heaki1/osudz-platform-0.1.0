// participant_permissions table access.
//
// docs/todo.txt C5. These are MANUAL administrator controls applied after an
// investigation, not an automatic punishment system, and submitting and voting are
// controlled INDEPENDENTLY: an administrator may stop a player from submitting, from
// voting, or from both, and may equally grant either to someone the country rule refuses.
//
// BOTH FLAGS ARE THREE-VALUED. NULL means "no override for this capability — the country
// allowlist decides", true grants it, false refuses it. That is why the columns are
// nullable rather than defaulted: writing a row to block voting must say nothing at all
// about submitting.
//
// A block is FORWARD-ONLY. Nothing here touches the votes table: a validly cast vote is
// counted permanently, and only an explicit result correction (D4) ever changes a recorded
// result. Blocking someone stops them voting again; it does not un-cast what they cast.

import { pool } from '../db.js';
import type { CapabilityOverride } from './users.js';

export interface ParticipantPermissionRow extends CapabilityOverride {
  user_id: number;
  note: string | null;
  set_by: number | null;
  set_at: Date;
}

/** A permission row alongside the account it belongs to, for the admin tabs. */
export interface ParticipantPermissionWithUser extends ParticipantPermissionRow {
  username: string;
  osu_id: string;
  country_code: string;
  avatar_url: string | null;
  set_by_name: string | null;
}

const COLUMNS = 'user_id, can_submit, can_vote, note, set_by, set_at';

/** The override for one account, or null when the country rule is the whole rule. */
export async function findForUser(userId: number): Promise<ParticipantPermissionRow | null> {
  const { rows } = await pool.query<ParticipantPermissionRow>(
    `SELECT ${COLUMNS} FROM participant_permissions WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * Every override, newest decision first, with the account it applies to and the
 * administrator who made it. These are the "exceptions" the Eligibility tab lists.
 */
export async function listAll(): Promise<ParticipantPermissionWithUser[]> {
  const { rows } = await pool.query<ParticipantPermissionWithUser>(
    `SELECT p.user_id, p.can_submit, p.can_vote, p.note, p.set_by, p.set_at,
            u.username, u.osu_id, u.country_code, u.avatar_url,
            a.username AS set_by_name
       FROM participant_permissions p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN users a ON a.id = p.set_by
      ORDER BY p.set_at DESC`
  );
  return rows;
}

/**
 * Sets or replaces one account's override.
 *
 * Every field is written, including the nulls: an administrator clearing the vote override
 * while keeping the submit one is a legitimate edit, and merging instead of replacing would
 * make "clear this capability" impossible to express.
 */
export async function upsert(
  userId: number,
  values: { canSubmit: boolean | null; canVote: boolean | null; note: string | null },
  adminId: number
): Promise<ParticipantPermissionRow> {
  const { rows } = await pool.query<ParticipantPermissionRow>(
    `INSERT INTO participant_permissions (user_id, can_submit, can_vote, note, set_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       can_submit = EXCLUDED.can_submit,
       can_vote   = EXCLUDED.can_vote,
       note       = EXCLUDED.note,
       set_by     = EXCLUDED.set_by,
       set_at     = now()
     RETURNING ${COLUMNS}`,
    [userId, values.canSubmit, values.canVote, values.note, adminId]
  );
  return rows[0];
}

/**
 * Drops the override entirely, so the country rule applies again. Reports whether a row
 * actually went, so clearing nothing answers 404 rather than a cheerful 200.
 */
export async function remove(userId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM participant_permissions WHERE user_id = $1',
    [userId]
  );
  return (rowCount ?? 0) > 0;
}

/** Maps a row to the override half of the ApiAdminUser DTO in src/api/client.ts. */
export function toApiOverride(row: ParticipantPermissionRow) {
  return {
    canSubmit: row.can_submit,
    canVote: row.can_vote,
    note: row.note,
    setBy: row.set_by,
    setAt: row.set_at.toISOString(),
  };
}
