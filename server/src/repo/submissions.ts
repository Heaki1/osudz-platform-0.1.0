// submissions table access.
//
// Two type notes that bite if ignored: node-postgres returns `bigint` and
// `numeric` as strings — the first to avoid precision loss, the second because
// numeric has no lossless JS counterpart — so beatmapset_id, difficulty_id,
// stars, cs, ar, od and hp are all read as strings and converted explicitly.
//
// Vote counts are computed here rather than stored, so submissions and votes can
// never drift apart. Every row routes/votes.ts writes shows up in the next read.

import { pool } from '../db.js';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export const REVIEW_DECISIONS = ['approved', 'rejected'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * The mod and challenge-requirement lists that SEEDED site_settings (C9).
 *
 * These are no longer the rule. routes/submissions.ts validates against
 * site_settings.allowed_mods and .allowed_challenge_types, which an administrator edits, and
 * migration 011 seeded those columns from exactly these values so nothing changed on the day
 * the store landed.
 *
 * Kept because repo/challengeScores.ts judges challenge types BY NAME — qualifies() and
 * orderFor() switch on these strings — so they document which names carry behaviour. Renaming
 * one in the admin tab is not only a settings change, and this is where to look to find out
 * why.
 */
// NM (No Mod) has been replaced by FM (Free Mods). FM means any combination of mods
// is allowed — a player using HD, HR, NM, or anything else passes mod compliance.
// repo/challengeScores.ts qualifies() and repo/dzpp.ts splitModAcronyms() both treat
// 'FM' as "always passes", so renaming this in the admin tab is not only a settings change.
export const SEEDED_MODS = ['FM', 'HD', 'HR', 'DT', 'EZ', 'FL', 'HDHR', 'HDDT', 'HRDT'] as const;
export const SEEDED_CHALLENGE_TYPES = [
  'Full Combo',
  'Top #1 Score',
  'Best Accuracy',
  'Lowest Miss Count',
] as const;

export interface SubmissionRow {
  id: number;
  round_id: number;
  user_id: number;
  beatmapset_id: string;
  difficulty_id: string;
  title: string;
  artist: string;
  mapper: string;
  difficulty_name: string;
  map_status: string;
  cover_url: string | null;
  preview_url: string | null;
  stars: string;
  bpm: number;
  length_seconds: number;
  cs: string | null;
  ar: string | null;
  od: string | null;
  hp: string | null;
  mod_requirement: string;
  challenge_requirement: string;
  status: ReviewStatus;
  reviewed_at: Date | null;
  created_at: Date;
  submitted_by_name: string;
  vote_count: number;
}

const SELECT = `
  SELECT s.id, s.round_id, s.user_id, s.beatmapset_id, s.difficulty_id,
         s.title, s.artist, s.mapper, s.difficulty_name, s.map_status,
         s.cover_url, s.preview_url, s.stars, s.bpm, s.length_seconds,
         s.cs, s.ar, s.od, s.hp,
         s.mod_requirement, s.challenge_requirement, s.status, s.reviewed_at, s.created_at,
         u.username AS submitted_by_name,
         (SELECT count(*) FROM votes v WHERE v.submission_id = s.id)::int AS vote_count
    FROM submissions s
    JOIN users u ON u.id = s.user_id`;

/** Every submission in a round, newest first. Pass a status to filter. */
export async function listForRound(roundId: number, status?: ReviewStatus): Promise<SubmissionRow[]> {
  const { rows } = await pool.query<SubmissionRow>(
    `${SELECT}
      WHERE s.round_id = $1 AND ($2::text IS NULL OR s.status = $2)
      ORDER BY s.created_at DESC`,
    [roundId, status ?? null]
  );
  return rows;
}

export async function findById(id: number): Promise<SubmissionRow | null> {
  const { rows } = await pool.query<SubmissionRow>(`${SELECT} WHERE s.id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Withdraws the caller's entry. Only ever reached during the submission phase, and
 * that gate is what makes it safe: votes.submission_id is ON DELETE CASCADE, so
 * deleting an entry that had votes would take the votes with it and shift every
 * tally. No vote can exist before the voting phase.
 */
export async function removeByUserAndRound(userId: number, roundId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM submissions WHERE user_id = $1 AND round_id = $2`,
    [userId, roundId]
  );
  return (rowCount ?? 0) > 0;
}

/** Enforced in the database too, by submissions_one_per_user_per_round. */
export async function findByUserAndRound(
  userId: number,
  roundId: number
): Promise<SubmissionRow | null> {
  const { rows } = await pool.query<SubmissionRow>(
    `${SELECT} WHERE s.user_id = $1 AND s.round_id = $2`,
    [userId, roundId]
  );
  return rows[0] ?? null;
}

export interface NewSubmission {
  roundId: number;
  userId: number;
  beatmapsetId: number;
  difficultyId: number;
  title: string;
  artist: string;
  mapper: string;
  difficultyName: string;
  mapStatus: string;
  coverUrl: string;
  previewUrl: string;
  stars: number;
  bpm: number;
  lengthSeconds: number;
  cs: number | null;
  ar: number | null;
  od: number | null;
  hp: number | null;
  modRequirement: string;
  challengeRequirement: string;
}

/** Inserts as 'pending'; an admin decides with review(). */
export async function create(submission: NewSubmission): Promise<SubmissionRow> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO submissions
       (round_id, user_id, beatmapset_id, difficulty_id, title, artist, mapper,
        difficulty_name, map_status, cover_url, preview_url, stars, bpm, length_seconds,
        cs, ar, od, hp, mod_requirement, challenge_requirement, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20, 'pending')
     RETURNING id`,
    [
      submission.roundId,
      submission.userId,
      submission.beatmapsetId,
      submission.difficultyId,
      submission.title,
      submission.artist,
      submission.mapper,
      submission.difficultyName,
      submission.mapStatus,
      submission.coverUrl,
      submission.previewUrl,
      submission.stars,
      submission.bpm,
      submission.lengthSeconds,
      submission.cs,
      submission.ar,
      submission.od,
      submission.hp,
      submission.modRequirement,
      submission.challengeRequirement,
    ]
  );

  // Re-read through SELECT so the caller gets the joined username and vote count
  // rather than a differently shaped row.
  const created = await findById(rows[0].id);
  if (!created) throw new Error('submission vanished immediately after insert');
  return created;
}

/** Records an admin decision. Returns null when the submission no longer exists. */
export async function review(
  id: number,
  decision: ReviewDecision,
  reviewerId: number
): Promise<SubmissionRow | null> {
  const { rowCount } = await pool.query(
    `UPDATE submissions
        SET status = $2, reviewed_by = $3, reviewed_at = now()
      WHERE id = $1`,
    [id, decision, reviewerId]
  );
  return rowCount === 0 ? null : findById(id);
}

/** "2:19" — ApiSubmission.length is the display string; the column is seconds. */
function formatLength(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

const asNumber = (value: string | null): number => (value === null ? 0 : Number(value));

/** Maps a row to the ApiSubmission DTO declared in src/api/client.ts. */
export function toApiSubmission(row: SubmissionRow) {
  return {
    id: row.id,
    beatmapsetId: Number(row.beatmapset_id),
    difficultyId: Number(row.difficulty_id),
    title: row.title,
    artist: row.artist,
    mapper: row.mapper,
    difficultyName: row.difficulty_name,
    mapStatus: row.map_status,
    coverUrl: row.cover_url ?? '',
    previewUrl: row.preview_url ?? '',
    stars: Number(row.stars),
    bpm: row.bpm,
    length: formatLength(row.length_seconds),
    cs: asNumber(row.cs),
    ar: asNumber(row.ar),
    od: asNumber(row.od),
    hp: asNumber(row.hp),
    modRequirement: row.mod_requirement,
    challengeRequirement: row.challenge_requirement,
    submittedByName: row.submitted_by_name,
    voteCount: row.vote_count,
    reviewStatus: row.status,
    submittedAt: row.created_at.toISOString(),
  };
}
