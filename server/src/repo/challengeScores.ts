// Challenge-phase scores.
//
// One row per user per round, holding their play on the winning beatmap. The table
// has existed since 002_challenge_scores.sql and nothing read it until now.
//
// The round's winning submission carries the two requirements a play is judged
// against — mod_requirement and challenge_requirement — and challenge_scores itself
// keys only on round_id, with no beatmap reference. That is deliberate: there is one
// challenge map per round, so the round is enough to find it.

import { pool } from '../db.js';

export interface ChallengeScoreRow {
  id: number;
  round_id: number;
  user_id: number;
  /** bigint: pg hands these back as strings. */
  score: string;
  /** numeric(5,2), also a string. Stored as a percentage, 0.00 to 100.00. */
  accuracy: string;
  misses: number;
  mods: string;
  qualified: boolean;
  /** numeric(8,2), also a string. Null when osu! reported no pp for the play. */
  pp: string | null;
  osu_score_id: string | null;
  submitted_at: Date;
  /** Joined from users, for the leaderboard. */
  username: string;
  osu_id: string;
  avatar_url: string | null;
}

export interface NewChallengeScore {
  roundId: number;
  userId: number;
  score: number;
  /** A percentage, 0-100. The osu! API reports a 0..1 fraction; convert before here. */
  accuracy: number;
  misses: number;
  /** Acronyms joined with no separator ('HDHR'), or 'NM' for a no-mod play. */
  mods: string;
  qualified: boolean;
  /** osu! pp for the play, or null when osu! reported none. The DZPP performance term. */
  pp: number | null;
  /** The osu! score id when this came from the API; null when entered by hand. */
  osuScoreId: number | null;
}

const COLUMNS = `cs.id, cs.round_id, cs.user_id, cs.score, cs.accuracy, cs.misses,
                 cs.mods, cs.qualified, cs.pp, cs.osu_score_id, cs.submitted_at,
                 u.username, u.osu_id, u.avatar_url`;

const SELECT = `SELECT ${COLUMNS} FROM challenge_scores cs JOIN users u ON u.id = cs.user_id`;

// ── Qualification ────────────────────────────────────────────────────────────
//
// Only two of the round's requirements can be judged from a single play.
//
// The mod requirement is absolute: every required acronym has to be present. 'NM'
// means no mods at all, which is why it is checked as an empty list rather than as an
// acronym to look for.
//
// The challenge requirement splits. 'Full Combo' is absolute — this play either
// dropped no combo or it did. The other three ('Top #1 Score', 'Best Accuracy',
// 'Lowest Miss Count') are RELATIVE: they are decided by comparing every play in the
// round, so no single insert can know the answer. For those, qualifying means the play
// counts toward the challenge at all — right mods — and the ordering below is what
// expresses the requirement. 002_challenge_scores.sql's comment says qualified is
// "computed on insert", which is only true in that reading of it.
//
// A caveat worth keeping honest: a true Full Combo means no misses AND no dropped
// slider ends. The columns here record misses, not combo, so misses === 0 is the
// checkable approximation. Recording the beatmap's max combo would be needed to do
// better, and nothing stores it.

/**
 * Acronyms that do not count when judging a play. 'CL' is the Classic marker osu!
 * attaches to scores played under the old scoring model; it is a scoring mode rather
 * than a gameplay mod, and leaving it in would make every classic play fail a 'NM'
 * requirement for no reason a player would recognise.
 */
const IGNORED_MODS = ['CL'];

/** Splits a stored mod string ('HDHR') into acronyms (['HD', 'HR']). */
export function splitMods(mods: string): string[] {
  const text = mods.trim().toUpperCase();
  if (text === '' || text === 'NM') return [];
  // Every osu! mod acronym is two characters, so a fixed-width split is exact.
  return (text.match(/.{1,2}/g) ?? []).filter((acronym) => !IGNORED_MODS.includes(acronym));
}

export function qualifies(
  play: { mods: string; misses: number },
  requirement: { modRequirement: string; challengeRequirement: string }
): boolean {
  const required = splitMods(requirement.modRequirement);
  const played = splitMods(play.mods);

  const modsOk =
    required.length === 0
      ? played.length === 0
      : required.every((acronym) => played.includes(acronym));

  if (!modsOk) return false;
  if (requirement.challengeRequirement === 'Full Combo') return play.misses === 0;
  return true;
}

/**
 * How the round's leaderboard is ordered, which is where the three relative
 * requirements actually live. Score descending is the default and is the one the
 * challenge_scores_leaderboard index covers.
 */
export function orderFor(challengeRequirement: string): string {
  switch (challengeRequirement) {
    case 'Best Accuracy':
      return 'cs.accuracy DESC, cs.score DESC';
    case 'Lowest Miss Count':
      return 'cs.misses ASC, cs.score DESC';
    default:
      return 'cs.score DESC';
  }
}

// ── Reads and writes ─────────────────────────────────────────────────────────

/**
 * A round's scores, best first. Qualifying plays come before non-qualifying ones
 * whatever the requirement, so a leaderboard never opens with a play that did not
 * meet the mods.
 */
export async function listForRound(
  roundId: number,
  challengeRequirement: string
): Promise<ChallengeScoreRow[]> {
  const { rows } = await pool.query<ChallengeScoreRow>(
    `${SELECT} WHERE cs.round_id = $1
      ORDER BY cs.qualified DESC, ${orderFor(challengeRequirement)}, cs.submitted_at ASC`,
    [roundId]
  );
  return rows;
}

export async function findForUser(
  roundId: number,
  userId: number
): Promise<ChallengeScoreRow | null> {
  const { rows } = await pool.query<ChallengeScoreRow>(
    `${SELECT} WHERE cs.round_id = $1 AND cs.user_id = $2`,
    [roundId, userId]
  );
  return rows[0] ?? null;
}

/**
 * Records a play, replacing this user's previous one for the round.
 *
 * challenge_scores_one_per_user_per_round is the conflict target: the table holds a
 * player's current play, not a history of attempts. osu_score_id is UNIQUE as well,
 * so importing the same play twice for the same user is idempotent — and the manual
 * admin path deliberately writes null there, which is what keeps a hand-entered score
 * from ever colliding with an imported one.
 */
export async function upsert(score: NewChallengeScore): Promise<ChallengeScoreRow> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO challenge_scores
       (round_id, user_id, score, accuracy, misses, mods, qualified, pp, osu_score_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (round_id, user_id) DO UPDATE
        SET score        = EXCLUDED.score,
            accuracy     = EXCLUDED.accuracy,
            misses       = EXCLUDED.misses,
            mods         = EXCLUDED.mods,
            qualified    = EXCLUDED.qualified,
            pp           = EXCLUDED.pp,
            osu_score_id = EXCLUDED.osu_score_id,
            submitted_at = now()
     RETURNING id`,
    [
      score.roundId,
      score.userId,
      score.score,
      score.accuracy,
      score.misses,
      score.mods,
      score.qualified,
      score.pp,
      score.osuScoreId,
    ]
  );

  // Re-read through SELECT so the row carries the joined user, the way every other
  // read of this table does.
  const { rows: full } = await pool.query<ChallengeScoreRow>(`${SELECT} WHERE cs.id = $1`, [
    rows[0].id,
  ]);
  return full[0];
}

/**
 * Maps a row to the ApiChallengeScore DTO declared in src/api/client.ts.
 *
 * `dzpp` is PROVISIONAL and comes from the caller, because no single row can know it: the
 * placement award depends on where this play sits among the qualified ones and on how many
 * there are, which are facts about the whole round. A caller reading one score in isolation
 * passes null, which is honest rather than a zero.
 *
 * The value itself is always computed by scoreRound in repo/dzpp.ts — the same function that
 * freezes round_dzpp when the round ends — so there is one formula and one set of constants,
 * never a second copy for the live view.
 */
export function toApiChallengeScore(
  row: ChallengeScoreRow,
  rank: number,
  dzpp: number | null
) {
  return {
    rank,
    userId: row.user_id,
    osuId: Number(row.osu_id),
    username: row.username,
    avatarUrl: row.avatar_url ?? '',
    score: Number(row.score),
    accuracy: Number(row.accuracy),
    misses: row.misses,
    mods: row.mods,
    qualified: row.qualified,
    /**
     * DZPP as the round stands right now, or null when it cannot be known from one row.
     * Provisional: placement and the field factor both move while the challenge is open, and
     * only round_dzpp is final.
     */
    dzpp,
    /** Null when an administrator entered this by hand rather than importing it. */
    osuScoreId: row.osu_score_id === null ? null : Number(row.osu_score_id),
    submittedAt: row.submitted_at.toISOString(),
  };
}
