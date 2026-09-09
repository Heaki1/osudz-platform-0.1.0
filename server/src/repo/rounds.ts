// rounds table access.
//
// Exactly one round is "open" at a time: 001_core.sql enforces that with a
// partial unique index on (phase <> 'ended'), so findCurrent() can only ever
// match a single row. Ending a round and opening the next are therefore two
// separate steps — PATCH the phase to 'ended', then POST a new round — because
// a single row cannot be both.

import { pool } from '../db.js';
import { freezeEndedRound } from './dzpp.js';
import { announceBallotClosed, announcePhase } from '../services/discord.js';

export type RoundPhase = 'submission' | 'voting' | 'challenge' | 'ended';

/**
 * How far the round's winner has got. 'none' while voting runs; 'pending' once
 * voting closed with one clear leader; 'tiebreak' once it closed level; 'official'
 * once an administrator approved it, after which it never moves again.
 *
 * The phase stays 'voting' through pending and tiebreak, so this — not the phase —
 * is what closes the ballot. See migrations/004_round_winner.sql.
 */
export type WinnerStatus = 'none' | 'pending' | 'tiebreak' | 'official';

/** Phases a round can be in while still open. Mirrors Phase in src/types.ts. */
export const LIVE_PHASES = ['submission', 'voting', 'challenge'] as const;
export type LivePhase = (typeof LIVE_PHASES)[number];

const ALL_PHASES: readonly string[] = [...LIVE_PHASES, 'ended'];

export function isRoundPhase(value: unknown): value is RoundPhase {
  return typeof value === 'string' && ALL_PHASES.includes(value);
}

/**
 * Where a round may go from each phase. A round only ever moves forward, and
 * ending it is legal from anywhere — a round nobody submitted to should not have
 * to be walked through voting and challenge before it can be closed.
 *
 * Staying in the same phase counts as legal because PATCH /round/phase is also
 * how a deadline gets rewritten.
 *
 * isRoundPhase only ever checked that a phase name exists, so 'challenge' back to
 * 'submission' was accepted. Votes cast in the meantime keep counting, so a round
 * could be reopened, voted in again, and advanced with a tally nobody expected —
 * and once a winner is recorded, a backwards move would contradict it outright.
 *
 * voting -> challenge is deliberately absent. That move is what approving a winner
 * does (approveWinner below), and leaving it here would let the phase endpoint walk
 * straight past the approval it is supposed to require.
 */
const NEXT_PHASES: Record<RoundPhase, readonly RoundPhase[]> = {
  submission: ['voting', 'ended'],
  voting: ['ended'],
  challenge: ['ended'],
  ended: [],
};

export const canTransition = (from: RoundPhase, to: RoundPhase): boolean =>
  from === to || NEXT_PHASES[from].includes(to);

/** The column holding each live phase's scheduled end. */
const END_COLUMN: Record<LivePhase, string> = {
  submission: 'submission_ends_at',
  voting: 'voting_ends_at',
  challenge: 'challenge_ends_at',
};

export interface RoundRow {
  id: number;
  round_number: number;
  phase: RoundPhase;
  month: string;
  year: number;
  reward: string | null;
  submission_ends_at: Date | null;
  voting_ends_at: Date | null;
  challenge_ends_at: Date | null;
  winner_status: WinnerStatus;
  winning_submission_id: number | null;
  winner_vote_count: number | null;
  total_votes: number | null;
  winner_approved_by: number | null;
  winner_approved_at: Date | null;
  /** When DZPP was frozen for this round. Null means it has not been (migration 013). */
  dzpp_finalized_at: Date | null;
}

const COLUMNS = `id, round_number, phase, month, year, reward,
                 submission_ends_at, voting_ends_at, challenge_ends_at,
                 winner_status, winning_submission_id, winner_vote_count,
                 total_votes, winner_approved_by, winner_approved_at,
                 dzpp_finalized_at`;

// ── The clock ────────────────────────────────────────────────────────────────
//
// There is no scheduler process. Reading the open round is what makes time pass:
// findCurrent applies whatever the configured deadlines are owed before it returns,
// so the vote endpoints, the submission endpoints, the admin routes and the client's
// own read all see one phase, and none of them can act on a round the clock has
// already moved past. The cost is that the archive list, which does not go through
// findCurrent, can name a stale phase until someone reads the open round — and the
// client reads it on every page load.
//
// Exactly one step of the chain is not automatic:
//
//   submission --(submission_ends_at)--> voting                     automatic
//   voting     --(voting_ends_at)------> the ballot closes: winner  automatic
//                                        pending or tied, phase
//                                        still 'voting'
//   voting     --(an admin approves)---> challenge                  ADMIN ONLY
//   challenge  --(challenge_ends_at)---> ended, which is the        automatic
//                                        archive
//   (opening the next round)                                        ADMIN ONLY
//
// A round left alone can be owed more than one of these, so they are applied in
// order in a single pass. The pass always stops at the approval: no deadline can
// stand in for an administrator confirming a winner.

const isDue = (endsAt: Date | null): boolean => endsAt !== null && endsAt.getTime() <= Date.now();

/**
 * Moves a round on because its deadline passed, or returns null if it did not move.
 *
 * The phase in the WHERE clause is what makes this safe to run from concurrent
 * reads: the first caller's UPDATE matches, and every later one finds the phase
 * already moved and matches nothing. The comparison uses the database's now(), so an
 * app clock running fast cannot advance a round early — it simply leaves the move to
 * the next read. The column name is a fixed lookup on an already-narrowed phase,
 * never request text.
 */
async function advanceOnDeadline(
  id: number,
  from: LivePhase,
  to: RoundPhase
): Promise<RoundRow | null> {
  // The clock must not be a second, laxer set of rules: if a future edit to
  // NEXT_PHASES makes one of these moves illegal for an administrator, it is illegal
  // here too rather than quietly staying automatic.
  if (!canTransition(from, to)) return null;

  const { rows } = await pool.query<RoundRow>(
    `UPDATE rounds
        SET phase = $3
      WHERE id = $1 AND phase = $2 AND ${END_COLUMN[from]} <= now()
      RETURNING ${COLUMNS}`,
    [id, from, to]
  );
  return rows[0] ?? null;
}

/** Applies every transition the round is owed, in order, and returns where it lands. */
async function applyDueTransitions(round: RoundRow): Promise<RoundRow> {
  let current = round;

  if (current.phase === 'submission' && isDue(current.submission_ends_at)) {
    const moved = await advanceOnDeadline(current.id, 'submission', 'voting');
    if (moved) {
      current = moved;
      // Announced here rather than in the route, because this is the transition no
      // request asked for: only the clock performs it, so nowhere else could know.
      announcePhase(moved, 'voting', true);
    }
  }

  // The deadline closes the ballot; it does not move the phase. closeVoting locks the
  // row and refuses a round whose winner_status has already left 'none', so two
  // concurrent reads cannot both count the same ballot.
  if (
    current.phase === 'voting' &&
    current.winner_status === 'none' &&
    isDue(current.voting_ends_at)
  ) {
    const outcome = await closeVoting(current.id);
    if (outcome.ok) {
      current = outcome.round;
      announceBallotClosed(outcome.round, {
        tied: outcome.tied,
        votes: outcome.round.winner_vote_count,
        total: outcome.round.total_votes,
      });
    }
    // 'no-entries' leaves the ballot open deliberately. A round with nothing approved has
    // no winner to record, and inventing one is the thing this must never do. The clock
    // therefore stops here and the decision goes to an administrator, who has two: approve
    // a late entry so there is a ballot, or skip the empty phase and end the round —
    // skipEmptyVoting below. What it must NOT do is advance on its own, because both of
    // those are choices about the month rather than about the time.
  }

  if (current.phase === 'challenge' && isDue(current.challenge_ends_at)) {
    const moved = await advanceOnDeadline(current.id, 'challenge', 'ended');
    if (moved) {
      current = moved;
      // Ending the challenge is what freezes its DZPP. Only the caller whose UPDATE matched
      // gets here, so the ranking is scored once however many reads race for it — and
      // freezeEndedRound never throws, so a ranking problem cannot break every page load
      // through findCurrent().
      await freezeEndedRound(moved.id);
      announcePhase(moved, 'ended', true);
    }
  }

  return current;
}

/**
 * The open round, with the clock applied. Null when nothing is open — including the
 * case where this call is what archived it: an auto-archived round is not current, so
 * every page reads "no active round" until an administrator opens the next one, which
 * is the decision rather than a gap.
 */
export async function findCurrent(): Promise<RoundRow | null> {
  const { rows } = await pool.query<RoundRow>(
    `SELECT ${COLUMNS} FROM rounds WHERE phase <> 'ended' ORDER BY round_number DESC LIMIT 1`
  );
  const open = rows[0];
  if (!open) return null;

  const current = await applyDueTransitions(open);
  return current.phase === 'ended' ? null : current;
}

/**
 * How many distinct people took part in each of the given rounds.
 *
 * "Took part" is the union of three things: entering a beatmap, casting a vote, and
 * posting a challenge score. Any one of them is participation, and someone who did all
 * three is one person — which is why this is a UNION over (round_id, user_id) rather
 * than three counts added together.
 */
export async function participantCounts(roundIds: number[]): Promise<Map<number, number>> {
  if (roundIds.length === 0) return new Map();

  const { rows } = await pool.query<{ round_id: number; participants: string }>(
    `SELECT round_id, count(*)::text AS participants
       FROM (
         SELECT round_id, user_id FROM submissions       WHERE round_id = ANY($1::int[])
         UNION
         SELECT round_id, user_id FROM votes             WHERE round_id = ANY($1::int[])
         UNION
         SELECT round_id, user_id FROM challenge_scores  WHERE round_id = ANY($1::int[])
       ) taken
      GROUP BY round_id`,
    [roundIds]
  );

  return new Map(rows.map((row) => [row.round_id, Number(row.participants)]));
}

export async function listAll(): Promise<RoundRow[]> {
  const { rows } = await pool.query<RoundRow>(
    `SELECT ${COLUMNS} FROM rounds ORDER BY round_number DESC`
  );
  return rows;
}

export async function findById(id: number): Promise<RoundRow | null> {
  const { rows } = await pool.query<RoundRow>(`SELECT ${COLUMNS} FROM rounds WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export interface NewRound {
  month: string;
  year: number;
  reward: string | null;
  submissionEndsAt: Date | null;
  votingEndsAt: Date | null;
  challengeEndsAt: Date | null;
}

/**
 * round_number is allocated inside the INSERT rather than by a preceding SELECT,
 * so two concurrent creates cannot read the same maximum. If they collide anyway
 * the UNIQUE constraint rejects the loser, which the route maps to 409.
 */
export async function create(round: NewRound): Promise<RoundRow> {
  const { rows } = await pool.query<RoundRow>(
    `INSERT INTO rounds
       (round_number, phase, month, year, reward,
        submission_ends_at, voting_ends_at, challenge_ends_at)
     SELECT COALESCE(MAX(round_number), 0) + 1, 'submission', $1, $2, $3, $4, $5, $6
       FROM rounds
     RETURNING ${COLUMNS}`,
    [
      round.month,
      round.year,
      round.reward,
      round.submissionEndsAt,
      round.votingEndsAt,
      round.challengeEndsAt,
    ]
  );
  return rows[0];
}

/**
 * Moves one round to another phase. `endsAt` is optional: pass it to also rewrite
 * the new phase's scheduled end (an admin advancing early or late), omit it to
 * keep the schedule laid down when the round was created. Omitting it after a
 * late advance leaves a countdown that has already run out — visible, but stale.
 */
export async function setPhase(
  id: number,
  phase: RoundPhase,
  endsAt?: Date | null
): Promise<RoundRow | null> {
  if (endsAt === undefined || phase === 'ended') {
    const { rows } = await pool.query<RoundRow>(
      `UPDATE rounds SET phase = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, phase]
    );
    return rows[0] ?? null;
  }

  // The column name comes from a fixed lookup on an already-validated phase,
  // never from request text.
  const { rows } = await pool.query<RoundRow>(
    `UPDATE rounds SET phase = $2, ${END_COLUMN[phase]} = $3 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, phase, endsAt]
  );
  return rows[0] ?? null;
}

// ── Closing the ballot and approving a winner ────────────────────────────────

export type CloseVotingOutcome =
  | { ok: true; round: RoundRow; tied: number[] }
  | { ok: false; reason: 'not-voting' | 'already-closed' | 'no-entries' };

/**
 * Closes the ballot and records the outcome, in one transaction.
 *
 * Counting, freezing and setting the status have to land together. routes/votes.ts
 * refuses to cast or retract once winner_status leaves 'none', so any gap between
 * reading the tally and writing it is a window in which a vote could slip in behind
 * the count that was just taken. The row is locked FOR UPDATE for the same reason:
 * two administrators closing at the same moment must not both compute a winner.
 *
 * Only approved entries of this round are counted. Nothing in the schema ties a
 * vote's submission to its round, and a submission rejected after votes were cast
 * for it keeps them — docs/todo.txt: a validly cast vote is counted permanently, so
 * the tally is not re-filtered by who is still eligible or what is still approved.
 * It counts what was cast, against the entries that were in the ballot.
 */
export async function closeVoting(roundId: number): Promise<CloseVotingOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: locked } = await client.query<{ phase: RoundPhase; winner_status: WinnerStatus }>(
      `SELECT phase, winner_status FROM rounds WHERE id = $1 FOR UPDATE`,
      [roundId]
    );
    const current = locked[0];
    if (!current || current.phase !== 'voting') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not-voting' };
    }
    if (current.winner_status !== 'none') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'already-closed' };
    }

    const { rows: tally } = await client.query<{ submission_id: number; votes: number }>(
      `SELECT s.id AS submission_id, count(v.id)::int AS votes
         FROM submissions s
         LEFT JOIN votes v ON v.submission_id = s.id
        WHERE s.round_id = $1 AND s.status = 'approved'
        GROUP BY s.id
        ORDER BY votes DESC, s.id ASC`,
      [roundId]
    );

    if (tally.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'no-entries' };
    }

    const total = tally.reduce((sum, row) => sum + row.votes, 0);
    const top = tally[0].votes;
    // Entries level at the top. With no votes at all every entry is level on zero,
    // which is a tie like any other and goes to an administrator rather than to
    // whichever row the database happened to return first.
    const leaders = tally.filter((row) => row.votes === top);
    const tied = leaders.length > 1;

    const { rows: updated } = await client.query<RoundRow>(
      `UPDATE rounds
          SET winner_status = $2,
              winning_submission_id = $3,
              winner_vote_count = $4,
              total_votes = $5
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [roundId, tied ? 'tiebreak' : 'pending', tied ? null : leaders[0].submission_id, top, total]
    );

    if (tied) {
      for (const leader of leaders) {
        await client.query(
          `INSERT INTO round_tiebreak_entries (round_id, submission_id) VALUES ($1, $2)`,
          [roundId, leader.submission_id]
        );
      }
    }

    await client.query('COMMIT');
    return {
      ok: true,
      round: updated[0],
      tied: tied ? leaders.map((leader) => leader.submission_id) : [],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── The empty ballot ─────────────────────────────────────────────────────────
//
// A round can reach the voting phase with nothing approved: nobody entered, or
// everything that was entered was rejected. closeVoting refuses that case with
// 'no-entries' rather than inventing a winner, and the clock in applyDueTransitions
// leaves the ballot open when it happens — which is correct, and also left the round
// with no way forward except the voting deadline it was already past.
//
// This is that way forward. The round ENDS: no winner, no challenge. A month nobody
// entered has no winner to crown and no map to play, and the alternatives are both
// lies — a fabricated winner, or a challenge phase with nothing to play.
//
// The transition itself was always legal (NEXT_PHASES.voting includes 'ended'), so what
// is new is not the move but the GUARD: the server counts the approved entries itself
// and refuses if there are any. That is what stops this being a way to throw away a
// real ballot, and it is why the check cannot live in the client.

export type SkipVotingRefusal = 'not-voting' | 'already-closed' | 'has-entries';

/** 'gone' is not part of the rule — only the transaction can find the row missing. */
export type SkipVotingFailure = SkipVotingRefusal | 'gone';

/**
 * Whether an empty voting phase may be skipped, and if not, which rule refused.
 *
 * PURE, and it takes the count rather than reading it, for the same reason isEligible
 * and checkBeatmapRules do: the rule is then testable without a database, and the
 * transaction below supplies the facts it has just locked.
 *
 * ORDER MATTERS. The phase is checked first because "this round is not voting" is the
 * more fundamental answer, and an already-closed ballot is reported as such rather than
 * as having entries — a round that closed with a winner pending has entries too, and
 * saying so would send an administrator looking for the wrong problem.
 */
export function refuseSkipVoting(
  round: { phase: RoundPhase; winner_status: WinnerStatus },
  approvedEntries: number
): SkipVotingRefusal | null {
  if (round.phase !== 'voting') return 'not-voting';
  if (round.winner_status !== 'none') return 'already-closed';
  if (approvedEntries > 0) return 'has-entries';
  return null;
}

export type SkipVotingOutcome =
  | { ok: true; round: RoundRow }
  | { ok: false; reason: SkipVotingFailure; approvedEntries: number };

/**
 * Ends a round whose ballot is empty, in one transaction.
 *
 * winner_status stays 'none' and winning_submission_id stays NULL, which is already a
 * representable and honest state: ended, never had a winner. Nothing needed a new
 * winner_status value — 004_round_winner.sql constrains that column to four, and
 * routes/challenge.ts already handles a round archived from a phase that recorded no
 * winner, because F1 could always archive one.
 *
 * FOR UPDATE, and the count inside the same transaction, so two administrators cannot
 * both act on the same ballot. The lock is on the rounds row, so an approval committed
 * by a third administrator in the instant between the count and the UPDATE is still
 * possible — the same window closeVoting has. It is benign here: the round ends with no
 * winner either way, and an approved entry in an archived round is a row nobody votes
 * on, not a corrupt result. Fabricating a winner or entering the challenge without one
 * remains impossible by construction, since this only ever writes 'ended'.
 */
export async function skipEmptyVoting(roundId: number): Promise<SkipVotingOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: locked } = await client.query<{ phase: RoundPhase; winner_status: WinnerStatus }>(
      `SELECT phase, winner_status FROM rounds WHERE id = $1 FOR UPDATE`,
      [roundId]
    );
    const current = locked[0];
    if (!current) {
      // Only reachable if the round was deleted between findCurrent and this lock. Its own
      // reason rather than 'not-voting', which would answer with a phase that no longer
      // exists — the route's message is built from the phase it read a moment ago.
      await client.query('ROLLBACK');
      return { ok: false, reason: 'gone', approvedEntries: 0 };
    }

    const { rows: counted } = await client.query<{ approved: number }>(
      `SELECT count(*)::int AS approved
         FROM submissions WHERE round_id = $1 AND status = 'approved'`,
      [roundId]
    );
    const approvedEntries = counted[0]?.approved ?? 0;

    const refusal = refuseSkipVoting(current, approvedEntries);
    if (refusal !== null) {
      await client.query('ROLLBACK');
      return { ok: false, reason: refusal, approvedEntries };
    }

    const { rows: updated } = await client.query<RoundRow>(
      `UPDATE rounds SET phase = 'ended' WHERE id = $1 RETURNING ${COLUMNS}`,
      [roundId]
    );

    await client.query('COMMIT');

    // After the commit, deliberately: the round has to BE ended before its DZPP can be
    // frozen, and freezeEndedRound takes its own connection. A ballot this empty had no
    // challenge phase and so has no scores, so this writes no rows — it stamps the latch, so
    // the round reads as settled rather than as one nobody ever got round to scoring.
    await freezeEndedRound(roundId);

    return { ok: true, round: updated[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** The entries an administrator may choose between while the round is tied. */
export async function listTiebreakEntries(roundId: number): Promise<number[]> {
  const { rows } = await pool.query<{ submission_id: number }>(
    `SELECT submission_id FROM round_tiebreak_entries WHERE round_id = $1 ORDER BY submission_id`,
    [roundId]
  );
  return rows.map((row) => row.submission_id);
}

export type ApproveWinnerOutcome =
  | { ok: true; round: RoundRow }
  | { ok: false; reason: 'not-closed' | 'already-official' | 'needs-selection' | 'not-tied' };

/**
 * Makes the winner official and moves the round to its challenge phase, in one
 * transaction. This is the only path from voting to challenge — NEXT_PHASES does not
 * offer that move, so the generic phase endpoint cannot approve a winner by accident.
 *
 * On a tiebreak the caller must name which tied entry won. On a pending winner the
 * entry is already recorded, and naming a different one is refused rather than
 * quietly honoured.
 */
export async function approveWinner(
  roundId: number,
  adminUserId: number,
  submissionId?: number
): Promise<ApproveWinnerOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: locked } = await client.query<{
      winner_status: WinnerStatus;
      winning_submission_id: number | null;
    }>(`SELECT winner_status, winning_submission_id FROM rounds WHERE id = $1 FOR UPDATE`, [
      roundId,
    ]);
    const current = locked[0];
    if (!current || current.winner_status === 'none') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not-closed' };
    }
    if (current.winner_status === 'official') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'already-official' };
    }

    let winner = current.winning_submission_id;

    if (current.winner_status === 'tiebreak') {
      if (submissionId === undefined) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'needs-selection' };
      }
      const { rows: candidate } = await client.query(
        `SELECT 1 FROM round_tiebreak_entries WHERE round_id = $1 AND submission_id = $2`,
        [roundId, submissionId]
      );
      if (candidate.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not-tied' };
      }
      winner = submissionId;
    } else if (submissionId !== undefined && submissionId !== winner) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not-tied' };
    }

    const { rows: updated } = await client.query<RoundRow>(
      `UPDATE rounds
          SET winner_status = 'official',
              winning_submission_id = $2,
              winner_approved_by = $3,
              winner_approved_at = now(),
              phase = 'challenge'
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [roundId, winner, adminUserId]
    );

    // The candidates existed only to be chosen between.
    await client.query(`DELETE FROM round_tiebreak_entries WHERE round_id = $1`, [roundId]);

    await client.query('COMMIT');
    return { ok: true, round: updated[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Maps a row to the ApiRound DTO declared in src/api/client.ts. */
export function toApiRound(row: RoundRow) {
  return {
    id: row.id,
    roundNumber: row.round_number,
    phase: row.phase,
    month: row.month,
    year: row.year,
    reward: row.reward ?? '',
    submissionEndsAt: row.submission_ends_at?.toISOString() ?? null,
    votingEndsAt: row.voting_ends_at?.toISOString() ?? null,
    challengeEndsAt: row.challenge_ends_at?.toISOString() ?? null,
    winnerStatus: row.winner_status,
    winningSubmissionId: row.winning_submission_id,
    winnerVoteCount: row.winner_vote_count,
    totalVotes: row.total_votes,
    winnerApprovedAt: row.winner_approved_at?.toISOString() ?? null,
    /**
     * Read-only status, for the admin recompute panel: null means this round's DZPP was never
     * frozen. It is on the round rather than counted from round_dzpp because the latch is the
     * authoritative answer — a round can be finalized to zero rows, and a row count cannot tell
     * that apart from never having run.
     */
    dzppFinalizedAt: row.dzpp_finalized_at?.toISOString() ?? null,
  };
}

// ── Result correction (D4) ───────────────────────────────────────────────────
//
// THE ONLY WAY A RECORDED RESULT EVER CHANGES. A validly cast vote is counted
// permanently, a later voter block is forward-only, and a later submission rejection does
// not retroactively discount votes — so if a result genuinely has to be corrected, an
// administrator does it explicitly and visibly rather than as a side effect of anything
// else. Without this the permanence rule had no remedy but editing the database by hand.
//
// APPEND-ONLY AUDIT. Every correction inserts a round_result_corrections row carrying the
// previous winner and the previous status, so the old value stays readable rather than
// being overwritten in place, and a round corrected twice keeps both steps.

export type CorrectWinnerOutcome =
  | { ok: true; round: RoundRow }
  | { ok: false; reason: 'no-result' | 'not-in-round' | 'unchanged' };

export interface CorrectionRow {
  id: number;
  round_id: number;
  previous_submission_id: number | null;
  new_submission_id: number | null;
  previous_winner_status: string;
  reason: string;
  corrected_by: number | null;
  corrected_at: Date;
}

/**
 * Overrides a round's recorded winner.
 *
 * Refuses a round with no recorded result: nothing to correct is closeVoting's business, and
 * an unresolved tie is approveWinner's. Two paths to the same state would mean two places
 * that have to agree about what "official" means.
 *
 * winner_status is left exactly as it was. A correction changes WHICH entry won, not how far
 * through the approval the round is — moving it would let a correction quietly approve a
 * winner nobody had approved.
 */
export async function correctWinner(
  roundId: number,
  submissionId: number,
  reason: string,
  adminUserId: number
): Promise<CorrectWinnerOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: locked } = await client.query<{
      winner_status: WinnerStatus;
      winning_submission_id: number | null;
    }>('SELECT winner_status, winning_submission_id FROM rounds WHERE id = $1 FOR UPDATE', [roundId]);

    const current = locked[0];
    if (!current || current.winning_submission_id === null) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'no-result' };
    }
    if (current.winning_submission_id === submissionId) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'unchanged' };
    }

    // The correction has to name an entry from THIS round. Without the round check the
    // schema would happily record last month's entry as this month's winner.
    const { rows: candidate } = await client.query(
      'SELECT 1 FROM submissions WHERE id = $1 AND round_id = $2',
      [submissionId, roundId]
    );
    if (candidate.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not-in-round' };
    }

    // The audit row FIRST, carrying the value that is about to be replaced. Written inside
    // the same transaction as the update, so a correction can never land without its record.
    await client.query(
      `INSERT INTO round_result_corrections (
         round_id, previous_submission_id, new_submission_id, previous_winner_status,
         reason, corrected_by
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [roundId, current.winning_submission_id, submissionId, current.winner_status, reason, adminUserId]
    );

    const { rows: updated } = await client.query<RoundRow>(
      `UPDATE rounds
          SET winning_submission_id = $2,
              winner_approved_by = $3,
              winner_approved_at = now()
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [roundId, submissionId, adminUserId]
    );

    await client.query('COMMIT');
    return { ok: true, round: updated[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Every correction on a round, newest first, with the entries named. */
export async function listCorrections(roundId: number): Promise<
  (CorrectionRow & {
    previous_title: string | null;
    new_title: string | null;
    corrected_by_name: string | null;
  })[]
> {
  const { rows } = await pool.query(
    `SELECT c.*,
            prev.title AS previous_title,
            next.title AS new_title,
            u.username AS corrected_by_name
       FROM round_result_corrections c
       LEFT JOIN submissions prev ON prev.id = c.previous_submission_id
       LEFT JOIN submissions next ON next.id = c.new_submission_id
       LEFT JOIN users u          ON u.id = c.corrected_by
      WHERE c.round_id = $1
      ORDER BY c.corrected_at DESC, c.id DESC`,
    [roundId]
  );
  return rows;
}
