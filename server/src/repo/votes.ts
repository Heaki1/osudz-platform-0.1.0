// votes table access.
//
// One row per user per round. votes_one_per_user_per_round is the natural key, so
// changing a vote is an UPDATE of the row that is already there rather than a
// second insert — migrations/001_core.sql:98 states that outright.
//
// Nothing here writes a counter. Tallies are derived with COUNT(*) in
// repo/submissions.ts so the two can never drift apart, which means casting a vote
// touches this table and nothing else.

import { pool } from '../db.js';

export interface VoteRow {
  id: number;
  round_id: number;
  user_id: number;
  submission_id: number;
  created_at: Date;
  /** When the vote was last moved. Equal to created_at until the first move (B9). */
  updated_at: Date;
}

const COLUMNS = 'id, round_id, user_id, submission_id, created_at, updated_at';

export async function findByUserAndRound(
  userId: number,
  roundId: number
): Promise<VoteRow | null> {
  const { rows } = await pool.query<VoteRow>(
    `SELECT ${COLUMNS} FROM votes WHERE user_id = $1 AND round_id = $2`,
    [userId, roundId]
  );
  return rows[0] ?? null;
}

/**
 * Casts a vote, or moves an existing one onto another submission.
 *
 * The upsert *is* the one-vote rule: the unique constraint makes a second row
 * impossible, and DO UPDATE turns "change my vote" into one statement with no
 * read-modify-write race between two tabs.
 *
 * A change keeps the original created_at and stamps updated_at (B9), so "voted early and
 * stuck with it" and "switched at the last minute" are distinguishable after the fact. Only
 * the TIME is recorded, not the previous choice: recovering what the vote used to be needs a
 * history table, which B9 did not ask for and which nothing yet reads.
 */
export async function cast(
  roundId: number,
  userId: number,
  submissionId: number
): Promise<VoteRow> {
  const { rows } = await pool.query<VoteRow>(
    `INSERT INTO votes (round_id, user_id, submission_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (round_id, user_id) DO UPDATE SET
       submission_id = EXCLUDED.submission_id,
       updated_at    = now()
     RETURNING ${COLUMNS}`,
    [roundId, userId, submissionId]
  );
  return rows[0];
}

/** True when a vote was removed, false when there was nothing to remove. */
export async function retract(userId: number, roundId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM votes WHERE user_id = $1 AND round_id = $2`,
    [userId, roundId]
  );
  return (rowCount ?? 0) > 0;
}

// ── Moderation view ──────────────────────────────────────────────────────────
//
// The only read in this project that puts a voter and their choice in the same row.
// It exists for administrators investigating a dispute, and nothing public may use it:
// docs/todo.txt B11 makes ballot secrecy a rule, and the public surfaces keep to
// aggregates — voteCount is a COUNT(*), GET /votes/my is per-caller, and the "You" pill
// on the vote page marks only the caller's own row.

export interface VoteAuditRow {
  vote_id: number;
  user_id: number;
  username: string;
  osu_id: string;
  avatar_url: string | null;
  country_code: string;
  submission_id: number;
  submission_title: string;
  submission_artist: string;
  difficulty_name: string;
  created_at: Date;
  updated_at: Date;
}

/** Every vote in one round, with who cast it and what for. Newest first. */
export async function listForRound(roundId: number): Promise<VoteAuditRow[]> {
  const { rows } = await pool.query<VoteAuditRow>(
    `SELECT v.id           AS vote_id,
            u.id           AS user_id,
            u.username,
            u.osu_id,
            u.avatar_url,
            u.country_code,
            s.id           AS submission_id,
            s.title        AS submission_title,
            s.artist       AS submission_artist,
            s.difficulty_name,
            v.created_at,
            v.updated_at
       FROM votes v
       JOIN users u       ON u.id = v.user_id
       JOIN submissions s ON s.id = v.submission_id
      WHERE v.round_id = $1
      ORDER BY v.created_at DESC, v.id DESC`,
    [roundId]
  );
  return rows;
}

/** Maps a row to the ApiVoteAudit DTO declared in src/api/client.ts. */
export function toApiVoteAudit(row: VoteAuditRow) {
  return {
    voteId: row.vote_id,
    userId: row.user_id,
    username: row.username,
    osuId: Number(row.osu_id),
    avatarUrl: row.avatar_url ?? '',
    country: row.country_code,
    submissionId: row.submission_id,
    submissionTitle: row.submission_title,
    submissionArtist: row.submission_artist,
    difficultyName: row.difficulty_name,
    castAt: row.created_at.toISOString(),
    // B9. Equal to castAt until the vote is moved, so the panel can mark the ones that
    // changed — which is the case an administrator opening this view is looking for.
    movedAt: row.updated_at.toISOString(),
  };
}
