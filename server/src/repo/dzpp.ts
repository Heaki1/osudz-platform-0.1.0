// DZ Performance Points — the scoring formula, and the frozen rows it produces.
//
// TWO HALVES, and the split is the point. Everything down to scoreRound is PURE: no
// database, no Express, no osu! API, so every rule in the formula is testable without any
// of them. The table access is below it, and hands the pure half the facts it has already
// locked. The same shape as repo/rounds.ts, where refuseSkipVoting is a pure function of a
// round and a count, and repo/siteSettings.ts, where checkBeatmapRules is a pure function
// of a beatmap and the rules.
//
// The specification is docs/superpowers/specs/2026-09-05-dzpp-design.md, approved
// 2026-09-05. Every constant below is a policy decision recorded there rather than a
// number that can be tuned in passing: changing one needs a new DZPP_FORMULA_VERSION,
// because frozen historical rounds carry the version they were scored under.
//
//   finalDzpp = round(performance + completion + qualification + placement)
//   placement = basePlacementPoints(place) x fieldFactor(qualifiedPlayers)
//
// completion = CHALLENGE_SCORE_POINTS
//            + (hadApprovedSubmission ? SUBMISSION_APPROVED_POINTS : 0)
//            + (hadVote               ? VOTE_POINTS               : 0)
//
// There is deliberately no difficulty multiplier, no accuracy term, no full-combo bonus
// and no winner bonus. osu! pp already prices star rating, accuracy, misses and combo,
// and 1st place is already rewarded by the placement table.
//
// DZPP IS NOT osu! pp. The performance term is the pp of the play itself, read from the
// score; nothing here reads users.global_rank or any profile total.

import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { listForRound } from './challengeScores.js';

/**
 * Bumped whenever a constant or a rule below changes. Stored on every frozen row so a
 * round scored under version 1 stays explainable after version 2 exists — roadmap rule 7,
 * that historical DZPP must not silently change when a constant is retuned.
 */
export const DZPP_FORMULA_VERSION = 2;

/**
 * Completion is now three independent sub-awards that together replace the old flat
 * COMPLETION_POINTS = 10 constant.
 *
 * CHALLENGE_SCORE_POINTS — awarded unconditionally for having a challenge_scores row.
 *   Submitting or importing a score during the challenge phase earns this, whether the
 *   play met the requirements or not.
 *
 * SUBMISSION_APPROVED_POINTS — awarded when the player submitted a beatmap for the round
 *   AND an administrator approved it.
 *
 * VOTE_POINTS — awarded when the player cast a vote for the round AND still held it when
 *   the round ended (i.e. a votes row exists at finalization time).
 *
 * Maximum completion = 2 + 3 + 5 = 10, matching the old flat constant.
 */
export const CHALLENGE_SCORE_POINTS = 2;
export const SUBMISSION_APPROVED_POINTS = 3;
export const VOTE_POINTS = 5;

/** Awarded on top when the play met the round's stored requirements. */
export const QUALIFICATION_POINTS = 25;

/**
 * Base placement award, 1st place first. Ninth place and below earn nothing, which is the
 * absence of an entry rather than a zero in the table.
 */
export const PLACEMENT_TABLE = [50, 40, 30, 25, 20, 15, 10, 5] as const;

/** The qualified field size at which placement points are paid in full. */
export const FIELD_FACTOR_TARGET = 8;

/**
 * How much of the placement table a round actually pays, given how many players
 * qualified.
 *
 * THE SMALL-FIELD FIX, and the reason the earliest months cannot mint the most points:
 * winning a three-player round is worth 50 x 0.375 = 18.75, not 50. Without it the
 * thinnest turnout would produce the largest rewards and the first few players would lock
 * the table permanently.
 *
 * Every reachable value is an exact eighth, so the arithmetic is exact in binary floating
 * point and numeric(6,3) stores the product without loss. There is no rounding step here
 * for that reason — adding one would only hide drift that should never occur.
 *
 * A field of nobody returns 0 rather than a negative or a NaN. It is not reachable
 * through scoreRound, which only places players who qualified, but the function stays
 * total so a future caller cannot get a surprise out of it.
 */
export function fieldFactor(qualifiedPlayers: number): number {
  // Written as !(x > 0) rather than x <= 0 so that NaN lands here too.
  if (!(qualifiedPlayers > 0)) return 0;
  return Math.min(1, qualifiedPlayers / FIELD_FACTOR_TARGET);
}

/**
 * The table value for a placement, before the field factor.
 *
 * Anything that is not a whole place from 1st down earns nothing. scoreRound numbers from
 * 1 and never produces such a value, so this guard exists for the caller that has not
 * been written yet.
 */
export function basePlacementPoints(placement: number): number {
  if (!Number.isInteger(placement) || placement < 1) return 0;
  return PLACEMENT_TABLE[placement - 1] ?? 0;
}

/**
 * What a placement is actually worth in a round of this size.
 *
 * The field factor applies to THIS TERM ONLY. Completion, qualification and the
 * performance value are all unaffected by turnout.
 */
export function placementPoints(placement: number, qualifiedPlayers: number): number {
  return basePlacementPoints(placement) * fieldFactor(qualifiedPlayers);
}

// ── One player, one round ────────────────────────────────────────────────────

/** What the formula needs about a single play. */
export interface DzppScoreInput {
  /**
   * The osu! pp for this play, or null when osu! reported none — a Loved beatmap, an
   * unranked mod combination. Read from the score itself, never from the player's profile.
   */
  pp: number | null;
  /**
   * challenge_scores.qualified AS STORED, never recomputed here. 002_challenge_scores.sql
   * stores it so a past round keeps its verdict when the rule changes, and that is the
   * precedent this whole feature follows.
   */
  qualified: boolean;
  /** Position among the qualified plays, or null when this play did not qualify. */
  placement: number | null;
  /** How many players qualified in the round — the field factor's input. */
  qualifiedPlayers: number;
  /**
   * True when this player submitted a beatmap for the round AND an administrator approved
   * it. Earns SUBMISSION_APPROVED_POINTS. False when there was no submission or it was
   * pending/rejected.
   */
  hadApprovedSubmission: boolean;
  /**
   * True when this player held a vote for the round at the moment the round was finalized.
   * Earns VOTE_POINTS. A vote that was retracted before finalization does not count.
   */
  hadVote: boolean;
}

/**
 * The frozen result, term by term.
 *
 * The breakdown travels with the total rather than being recoverable from it, because the
 * ranking page has to be able to say WHY a player has the points they have. An opaque
 * formula in a small community produces arguments instead of competition.
 */
export interface DzppBreakdown {
  /** null when osu! had no pp for the play. Distinct from a real 0.00pp play. */
  performanceValue: number | null;
  completionPoints: number;
  qualificationPoints: number;
  placementPoints: number;
  /** null when the play did not qualify, whatever the caller passed in. */
  placement: number | null;
  qualified: boolean;
  fieldSize: number;
  /** The sum, rounded half-up to a whole number. */
  finalDzpp: number;
  formulaVersion: number;
}

/**
 * A performance value this formula is willing to use, or null.
 *
 * osu! cannot report a NaN, an infinity or a negative pp, so any of those means something
 * upstream is wrong. Reading them as "no value" keeps a bad number out of numeric(8,2) and
 * out of the total — the alternative is storing a NaN, or letting a negative subtract DZPP
 * a player legitimately earned elsewhere in the sum.
 */
const usablePerformance = (pp: number | null): number | null =>
  pp !== null && Number.isFinite(pp) && pp >= 0 ? pp : null;

/**
 * Scores one play.
 *
 * CHALLENGE_SCORE_POINTS IS UNCONDITIONAL HERE, and that is not a missing rule: this is
 * only ever called for a play that exists. A player with no challenge_scores row gets no
 * breakdown and no frozen row at all, which is the honest representation of not taking
 * part and is what keeps the ranking's rounds-played count right for free. One row per
 * player per round is guaranteed by challenge_scores_one_per_user_per_round, so attempts
 * cannot multiply the award.
 *
 * SUBMISSION_APPROVED_POINTS and VOTE_POINTS are conditional on the facts the caller
 * supplies. finalizeRound and recomputeRound query the database for these before scoring.
 *
 * A placement passed alongside qualified: false is dropped rather than honoured. Only
 * qualified players receive placement points, and a caller bug must not become points.
 */
export function scoreOne(input: DzppScoreInput): DzppBreakdown {
  const performanceValue = usablePerformance(input.pp);
  const placement = input.qualified ? input.placement : null;
  const placementAward =
    placement === null ? 0 : placementPoints(placement, input.qualifiedPlayers);
  const qualificationAward = input.qualified ? QUALIFICATION_POINTS : 0;
  const completionPoints =
    CHALLENGE_SCORE_POINTS +
    (input.hadApprovedSubmission ? SUBMISSION_APPROVED_POINTS : 0) +
    (input.hadVote ? VOTE_POINTS : 0);

  return {
    performanceValue,
    completionPoints,
    qualificationPoints: qualificationAward,
    placementPoints: placementAward,
    placement,
    qualified: input.qualified,
    fieldSize: input.qualifiedPlayers,
    // Rounded once, at the end. Per round rather than per total, so the rows on a
    // player's detail panel sum exactly to the total on the leaderboard.
    finalDzpp: Math.round(
      (performanceValue ?? 0) + completionPoints + qualificationAward + placementAward
    ),
    formulaVersion: DZPP_FORMULA_VERSION,
  };
}

// ── A whole round ────────────────────────────────────────────────────────────

/** One play in a round, as much of it as the formula needs. */
export interface DzppRoundPlay {
  userId: number;
  /** The osu! pp for the play, or null when osu! reported none. */
  pp: number | null;
  /** challenge_scores.qualified as stored. */
  qualified: boolean;
  /** True when this player had an approved submission for the round. */
  hadApprovedSubmission: boolean;
  /** True when this player held a vote for the round at finalization time. */
  hadVote: boolean;
}

/** A frozen result with the player it belongs to. */
export interface DzppRoundResult extends DzppBreakdown {
  userId: number;
}

/**
 * Scores every play in a round.
 *
 * THE CALLER SUPPLIES LEADERBOARD ORDER, and this function does not sort. listForRound in
 * repo/challengeScores.ts orders a round 'qualified DESC, <orderFor(requirement)>,
 * submitted_at ASC' — score descending normally, accuracy descending on a Best Accuracy
 * round, misses ascending on a Lowest Miss Count round — and that SQL is the only
 * implementation of the round's ordering in this project. Re-implementing it here would
 * make two orderings that can disagree, and the frozen points would then contradict the
 * leaderboard the players were actually shown. It is the same reason orderFor and orderHits
 * each say the server owns the ordering.
 *
 * Ties therefore never reach this function undecided: the requirement's own key breaks
 * them, then submitted_at, so the plays arrive in a settled sequence and are numbered
 * along it.
 *
 * NON-QUALIFYING PLAYS DO NOT CONSUME A PLACEMENT. They are numbered null and skipped,
 * because otherwise everybody behind one would be demoted for somebody else's failed
 * attempt. listForRound puts them last in any case, so the skip matters only if a future
 * caller hands them over interleaved.
 *
 * A player with no challenge_scores row is simply absent from the input and gets no result
 * — no row, rather than a zero row.
 */
export function scoreRound(playsInLeaderboardOrder: readonly DzppRoundPlay[]): DzppRoundResult[] {
  // The field factor counts QUALIFIED PLAYERS, not submissions, and it counts all of them
  // regardless of country: the field is the field that played. The Algeria filter belongs
  // to the ranking read, not to what happened in the round.
  const qualifiedPlayers = playsInLeaderboardOrder.filter((play) => play.qualified).length;

  let placed = 0;
  return playsInLeaderboardOrder.map((play) => ({
    userId: play.userId,
    ...scoreOne({
      pp: play.pp,
      qualified: play.qualified,
      placement: play.qualified ? ++placed : null,
      qualifiedPlayers,
      hadApprovedSubmission: play.hadApprovedSubmission,
      hadVote: play.hadVote,
    }),
  }));
}

// ── Reading a stored challenge score ─────────────────────────────────────────

/**
 * numeric comes back from node-postgres as a STRING, to avoid the silent precision loss of
 * a JS number — challenge_scores.accuracy is already read that way, and pp is no different.
 *
 * An empty or unparseable column reads as absent rather than as zero. Number('') is 0, so
 * trusting the conversion would quietly turn a broken read into a real zero-pp play, and
 * the difference between those two is exactly what the nullable column exists to record.
 */
const asPp = (value: string | null): number | null => {
  if (value === null || value.trim() === '') return null;
  const pp = Number(value);
  return Number.isFinite(pp) ? pp : null;
};

/**
 * A challenge_scores row as the formula wants it.
 *
 * Structural rather than an import of ChallengeScoreRow, so the pure half stays a function
 * of plain data and the two modules do not need each other to be testable.
 *
 * hadApprovedSubmission and hadVote are supplied by the caller (finalizeRound /
 * recomputeRound), which queries submissions and votes for the round before mapping.
 */
export function toRoundPlay(
  row: { user_id: number; pp: string | null; qualified: boolean },
  hadApprovedSubmission: boolean,
  hadVote: boolean
): DzppRoundPlay {
  return {
    userId: row.user_id,
    pp: asPp(row.pp),
    qualified: row.qualified,
    hadApprovedSubmission,
    hadVote,
  };
}

// ── Freezing a round ─────────────────────────────────────────────────────────

export type FinalizeRefusal = 'not-ended' | 'already-finalized';

/** 'gone' is not part of the rule — only the transaction can find the row missing. */
export type FinalizeFailure = FinalizeRefusal | 'gone';

/**
 * Whether a round's DZPP may be frozen, and if not, which rule refused.
 *
 * PURE, and it takes the round rather than reading it, for the same reason refuseSkipVoting
 * does: the rule is testable without a database, and the transaction below supplies the
 * facts it has just locked.
 *
 * ORDER MATTERS. The phase is checked first because "this round has not ended" is the more
 * fundamental answer — reporting an unended round as already-scored would send an
 * administrator looking for the wrong problem.
 */
export function refuseFinalize(round: {
  phase: string;
  dzpp_finalized_at: Date | null;
}): FinalizeRefusal | null {
  if (round.phase !== 'ended') return 'not-ended';
  if (round.dzpp_finalized_at !== null) return 'already-finalized';
  return null;
}

export type FinalizeOutcome =
  | { ok: true; results: DzppRoundResult[] }
  | { ok: false; reason: FinalizeFailure };

/**
 * Freezes a round's DZPP, in one transaction. Safe to call more than once.
 *
 * IDEMPOTENT BY THE LATCH, not by the insert. The round is locked FOR UPDATE, and a round
 * whose dzpp_finalized_at is already set is refused before anything is written — so a second
 * call cannot award a second set of points however it arrives. The INSERT is deliberately
 * plain rather than ON CONFLICT DO NOTHING: with the latch doing the work, a primary-key
 * collision would mean the latch had failed, and that should be loud.
 *
 * A ROUND WITH NO SCORES FINALIZES TO NOTHING AND STILL STAMPS THE LATCH. That happens for a
 * round ended from the submission phase, and for one closed through skipEmptyVoting, neither
 * of which ever had a challenge. Zero rows is the correct answer and the round is then closed
 * for good, rather than left looking unfinished forever.
 *
 * THE PLAYS ARE READ THROUGH listForRound, ON THE POOL, OUTSIDE THE LOCK. Two reasons that
 * is right rather than merely convenient. First, listForRound is the single implementation of
 * the round's ordering — 'qualified DESC, orderFor(requirement), submitted_at ASC' — and
 * re-issuing that SELECT here with the transaction client would make a second copy that can
 * drift, which is the failure orderFor and orderHits each warn about. Second, no write to
 * this round's challenge_scores is possible any more: POST /api/challenge/scores requires
 * phase === 'challenge', and POST /api/admin/challenge/scores goes through findCurrent(),
 * which never returns an ended round. The set being scored cannot move under the read.
 *
 * The same reasoning applies to the completion sub-award queries: submissions and votes for
 * an ended round cannot change, so reading them on the pool outside the lock is safe.
 */
export async function finalizeRound(roundId: number): Promise<FinalizeOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: locked } = await client.query<{
      phase: string;
      dzpp_finalized_at: Date | null;
      winning_submission_id: number | null;
    }>(
      `SELECT phase, dzpp_finalized_at, winning_submission_id
         FROM rounds WHERE id = $1 FOR UPDATE`,
      [roundId]
    );

    const current = locked[0];
    if (!current) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'gone' };
    }

    const refusal = refuseFinalize(current);
    if (refusal !== null) {
      await client.query('ROLLBACK');
      return { ok: false, reason: refusal };
    }

    // The requirement decides the leaderboard's order, so it decides the placements. A round
    // archived without a recorded winner has none, and listForRound falls back to score
    // descending for exactly that case.
    let requirement = '';
    if (current.winning_submission_id !== null) {
      const { rows } = await client.query<{ challenge_requirement: string }>(
        'SELECT challenge_requirement FROM submissions WHERE id = $1',
        [current.winning_submission_id]
      );
      requirement = rows[0]?.challenge_requirement ?? '';
    }

    // Completion sub-awards: which players had an approved submission and which held a vote.
    // Read on the pool (outside the transaction) for the same reason listForRound is: no
    // write to this round's submissions or votes is possible once the round has ended.
    const approvedSubmitters = await fetchApprovedSubmitters(roundId);
    const voters = await fetchVoters(roundId);

    const results = scoreRound(
      (await listForRound(roundId, requirement)).map((row) =>
        toRoundPlay(row, approvedSubmitters.has(row.user_id), voters.has(row.user_id))
      )
    );

    await insertRoundDzpp(client, roundId, results);

    // Stamped in the same transaction as the rows, so the latch and the data can never
    // disagree about whether this round was scored.
    await client.query('UPDATE rounds SET dzpp_finalized_at = now() WHERE id = $1', [roundId]);

    await client.query('COMMIT');
    return { ok: true, results };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * finalizeRound, but it never throws and never needs its outcome read.
 *
 * THE CALL SITES ARE ALL DOING SOMETHING ELSE AS THEIR REAL JOB. A round reaches
 * phase = 'ended' in exactly three places: the clock in applyDueTransitions, which
 * findCurrent() runs on every page load; the admin phase endpoint; and skipEmptyVoting. None
 * of them should fail because the ranking did — the round IS ended either way, and reporting
 * that as a failed phase change would be a lie about what happened.
 *
 * A failure therefore leaves dzpp_finalized_at NULL on an ended round, which is exactly the
 * state the Phase 7 admin recompute exists to find and repair. That is the cost of approved
 * decision 5: finalization in its own transaction rather than threaded through three others.
 *
 * 'already-finalized' is not logged. Ending a round the clock has just ended is an ordinary
 * race between two callers, and the latch answering "done" is the system working.
 */
export async function freezeEndedRound(roundId: number): Promise<void> {
  try {
    const outcome = await finalizeRound(roundId);
    if (!outcome.ok && outcome.reason !== 'already-finalized') {
      console.error(`[dzpp] round ${roundId} was not frozen: ${outcome.reason}`);
    }
  } catch (err) {
    console.error(
      `[dzpp] freezing round ${roundId} failed:`,
      err instanceof Error ? err.message : err
    );
  }
}

// ── The cumulative ranking ───────────────────────────────────────────────────
//
// WHO APPEARS: Algeria, and only Algeria. Approved decision 4 — the roadmap says "No other
// country should appear in the DZPP ranking" in so many words, so this filters on DZ itself
// rather than following allowed_countries. It is DZ-only either way today, and this constant
// is the one-line change if the policy should later track the allowlist.
//
// FROZEN ROWS ARE WRITTEN FOR EVERYONE WHO PLAYED, whatever their country. The filter lives
// here, on the read, so that field_size and placement describe the field that actually
// played, and so changing who is displayed never needs a recompute.

/** The only country in the DZ Performance Rankings. */
export const RANKING_COUNTRY = 'DZ';

// One copy of the country rule, composed into every query below. country_code is char(2) and
// Postgres blank-pads char, so reads trim — the same sentence isEligible and toApiUser use.
const RANKED_JOINS = `
    FROM round_dzpp d
    JOIN rounds r ON r.id = d.round_id
    JOIN users  u ON u.id = d.user_id
   WHERE upper(trim(u.country_code)) = $1`;

// The season. NULL means all-time, which is the default view.
const YEAR_FILTER = `
     AND ($2::int IS NULL OR r.year = $2)`;

export interface RankingRow {
  user_id: number;
  rank: number;
  dzpp: number;
  rounds_played: number;
  first_places: number;
  best_placement: number | null;
  /** bigint: pg hands these back as strings. */
  osu_id: string;
  username: string;
  avatar_url: string | null;
  country_code: string;
}

export interface PlayerRoundRow {
  round_id: number;
  round_number: number;
  month: string;
  year: number;
  /** numeric, so a string. Null when osu! reported no pp for the play. */
  performance_value: string | null;
  completion_points: string;
  qualification_points: string;
  placement_points: string;
  placement: number | null;
  qualified: boolean;
  field_size: number;
  final_dzpp: number;
}

/** Everything the page needs about the table other than the page itself. */
export interface RankingMeta {
  /** Players in the whole filtered table, for the pager. */
  total: number;
  /** Seasons that hold DZPP, newest first — the year selector's options. */
  years: number[];
}

/**
 * The pager total and the season list, in ONE query.
 *
 * They were two, and before that the total was awaited BEFORE the page — two serial round
 * trips for one screen. They combine cleanly because they read the same joins and differ only
 * in their filter, which FILTER expresses per aggregate: the count honours the requested
 * season, the year list deliberately does not, because the selector has to keep offering the
 * other seasons while one of them is showing.
 *
 * NOT count(*) OVER () on the page query, which was the other tempting shortcut: a window
 * count returns nothing when the requested page is past the end, and "page 9 of a 2-page
 * table" still has to report the real total. This is an aggregate with no GROUP BY, so it
 * always returns exactly one row whatever the filter matches.
 */
export async function rankingMeta(year: number | null): Promise<RankingMeta> {
  const { rows } = await pool.query<{ total: number; years: number[] }>(
    `SELECT count(DISTINCT d.user_id) FILTER (WHERE $2::int IS NULL OR r.year = $2)::int AS total,
            COALESCE(array_agg(DISTINCT r.year ORDER BY r.year DESC), '{}') AS years
       ${RANKED_JOINS}`,
    [RANKING_COUNTRY, year]
  );
  return { total: rows[0]?.total ?? 0, years: rows[0]?.years ?? [] };
}

/**
 * One page of the ranking, best first.
 *
 * TotalPoints is a PLAIN SUM — no decay, no best-N-of-M. osu! weights pp by 0.95^i because a
 * player has thousands of plays and ancient farm scores would otherwise dominate; here there
 * are twelve rounds a year, each unrepeatable, and the thing being rewarded IS sustained
 * monthly participation. Decay would punish exactly the loyalty this page exists to show.
 * The season filter, not decay, is what lets a newcomer compete with an early joiner.
 *
 * RANK() rather than the row number, so players level on points share a rank the way they do
 * on osu!'s own rankings. It is computed over the whole filtered set before LIMIT applies, so
 * a tie spanning a page boundary still reads correctly on both pages. Username breaks the
 * display order within a tie, which only decides who is printed first, not who ranks higher.
 */
export async function listRankings(
  year: number | null,
  limit: number,
  offset: number
): Promise<RankingRow[]> {
  const { rows } = await pool.query<RankingRow>(
    `WITH totals AS (
       SELECT d.user_id,
              SUM(d.final_dzpp)::int                       AS dzpp,
              count(*)::int                                AS rounds_played,
              count(*) FILTER (WHERE d.placement = 1)::int  AS first_places,
              min(d.placement)                             AS best_placement
         ${RANKED_JOINS} ${YEAR_FILTER}
        GROUP BY d.user_id
     )
     SELECT t.user_id, t.dzpp, t.rounds_played, t.first_places, t.best_placement,
            u.osu_id, u.username, u.avatar_url, u.country_code,
            RANK() OVER (ORDER BY t.dzpp DESC)::int AS rank
       FROM totals t
       JOIN users u ON u.id = t.user_id
      ORDER BY t.dzpp DESC, u.username ASC
      LIMIT $3 OFFSET $4`,
    [RANKING_COUNTRY, year, limit, offset]
  );
  return rows;
}

/**
 * One player's frozen rounds, newest first — the detail panel behind their row.
 *
 * Carries the whole breakdown rather than the total alone, because the page has to be able to
 * say WHY a player has the points they have. An opaque formula in a small community produces
 * arguments rather than competition.
 *
 * The country rule applies here too, so a player outside the ranking reads as an empty
 * history rather than as a hidden row with a reachable detail page. Empty is also the answer
 * for a player who simply has no finalized rounds yet, which is why this is 200 with [] in
 * the route rather than a 404 — the same choice GET /challenge/scores makes, and it leaks
 * nothing about which accounts exist.
 */
export async function listPlayerRounds(
  userId: number,
  year: number | null
): Promise<PlayerRoundRow[]> {
  const { rows } = await pool.query<PlayerRoundRow>(
    `SELECT d.round_id, r.round_number, r.month, r.year,
            d.performance_value, d.completion_points, d.qualification_points,
            d.placement_points, d.placement, d.qualified, d.field_size, d.final_dzpp
       ${RANKED_JOINS} ${YEAR_FILTER}
        AND d.user_id = $3
      ORDER BY r.round_number DESC`,
    [RANKING_COUNTRY, year, userId]
  );
  return rows;
}

/** Maps a row to the ApiRankingEntry DTO declared in src/api/client.ts. */
export function toApiRankingEntry(row: RankingRow) {
  return {
    rank: row.rank,
    userId: row.user_id,
    osuId: Number(row.osu_id),
    username: row.username,
    avatarUrl: row.avatar_url ?? '',
    country: row.country_code.trim(),
    dzpp: row.dzpp,
    roundsPlayed: row.rounds_played,
    firstPlaces: row.first_places,
    /** Null for a player who has never qualified in any counted round. */
    bestPlacement: row.best_placement,
  };
}

/** Maps a row to the ApiPlayerDzppRound DTO declared in src/api/client.ts. */
export function toApiPlayerDzppRound(row: PlayerRoundRow) {
  return {
    roundId: row.round_id,
    roundNumber: row.round_number,
    month: row.month,
    year: row.year,
    // asPp rather than Number, so a null column stays null instead of becoming 0.
    performanceValue: asPp(row.performance_value),
    completionPoints: Number(row.completion_points),
    qualificationPoints: Number(row.qualification_points),
    placementPoints: Number(row.placement_points),
    placement: row.placement,
    qualified: row.qualified,
    fieldSize: row.field_size,
    finalDzpp: row.final_dzpp,
  };
}

// ── Recomputing a frozen round (Phase 7) ─────────────────────────────────────
//
// THE ONLY SANCTIONED WAY A FROZEN ROUND EVER CHANGES. Freezing is what keeps roadmap rule 7
// honest — a constant retuned in month five must not silently rewrite months one to four — and
// its one cost is that a round sometimes genuinely has to be scored again. This is that, made
// explicit, audited, and scoped to one round at a time.
//
// ONE ROUND, NEVER A SWEEP. Every statement below is keyed on the round id, so a recompute
// cannot reach a round the caller did not name. There is deliberately no all-rounds form: a
// single call that rewrote every historical round would be one mistake away from reshaping the
// whole leaderboard, and no audit row can undo that.

export type RecomputeRefusal = 'not-ended';

/** 'gone' is not part of the rule — only the transaction can find the row missing. */
export type RecomputeFailure = RecomputeRefusal | 'gone';

/**
 * Whether a round's DZPP may be recomputed, and if not, which rule refused.
 *
 * DELIBERATELY NOT refuseFinalize. The two disagree on exactly one input, which is why both
 * exist: finalization refuses a round that has already been scored, because scoring it twice
 * would award the points twice, and a recompute is the sanctioned way to score it again — so
 * the latch must not refuse it here.
 *
 * It also accepts a round the latch never stamped, which is the round that ended before the
 * finalization hook existed. One action covers both, because two endpoints doing nearly the
 * same thing is how they drift apart.
 *
 * The one rule left is the phase: nothing is rescored while it can still change on its own.
 */
export function refuseRecompute(round: {
  phase: string;
  dzpp_finalized_at: Date | null;
}): RecomputeRefusal | null {
  return round.phase === 'ended' ? null : 'not-ended';
}

/** What a recompute changed, for the response and the audit row. */
export interface RecomputeSummary {
  roundId: number;
  previousRows: number;
  newRows: number;
  previousTotal: number;
  newTotal: number;
  /** Null when the round had never been scored — a missed finalization rather than a rescore. */
  previousFormulaVersion: number | null;
  newFormulaVersion: number;
  /** True when this round had no frozen rows at all before the call. */
  firstTime: boolean;
}

export type RecomputeOutcome =
  | { ok: true; summary: RecomputeSummary; results: DzppRoundResult[] }
  | { ok: false; reason: RecomputeFailure };

/**
 * Rescores one round and records what changed, in one transaction.
 *
 * ATOMIC BY CONSTRUCTION. The delete, the inserts, the audit row and the latch all land
 * together or not at all, so there is no window in which a round holds no DZPP, and no way for
 * the rewrite to happen without its record.
 *
 * SCOPED BY THE ROUND ID, everywhere. The DELETE names round_id and nothing else, the inserts
 * carry it, the audit row carries it, and the lock is on that round's row — so an unrelated
 * historical round cannot be touched even by accident.
 *
 * WHAT IT DOES NOT DO is re-read osu!. It rescores the plays as they are stored, through the
 * same listForRound ordering and the same scoreRound engine that froze them the first time, so
 * a recompute reflects a changed CONSTANT or a fixed bug and never a changed play. A round whose
 * scores lack pp will still lack it afterwards; recovering that needs the score re-imported
 * first, which is the admin manual-entry path and not this one.
 *
 * dzpp_finalized_at is COALESCEd rather than overwritten, so the moment a round was FIRST frozen
 * survives. Every later rescore has its own timestamped audit row, which is strictly more
 * information than moving the latch would leave.
 */
export async function recomputeRound(
  roundId: number,
  reason: string,
  adminUserId: number
): Promise<RecomputeOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: locked } = await client.query<{
      phase: string;
      dzpp_finalized_at: Date | null;
      winning_submission_id: number | null;
    }>(
      `SELECT phase, dzpp_finalized_at, winning_submission_id
         FROM rounds WHERE id = $1 FOR UPDATE`,
      [roundId]
    );

    const current = locked[0];
    if (!current) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'gone' };
    }

    const refusal = refuseRecompute(current);
    if (refusal !== null) {
      await client.query('ROLLBACK');
      return { ok: false, reason: refusal };
    }

    // What the round was worth, read inside the transaction so it describes exactly the rows
    // the DELETE below is about to remove.
    const { rows: before } = await client.query<{
      row_count: number;
      total: number;
      version: number | null;
    }>(
      `SELECT count(*)::int                       AS row_count,
              COALESCE(SUM(final_dzpp), 0)::int   AS total,
              MAX(formula_version)                AS version
         FROM round_dzpp WHERE round_id = $1`,
      [roundId]
    );
    const previous = before[0] ?? { row_count: 0, total: 0, version: null };

    let requirement = '';
    if (current.winning_submission_id !== null) {
      const { rows } = await client.query<{ challenge_requirement: string }>(
        'SELECT challenge_requirement FROM submissions WHERE id = $1',
        [current.winning_submission_id]
      );
      requirement = rows[0]?.challenge_requirement ?? '';
    }

    // Completion sub-awards: same logic as finalizeRound.
    const approvedSubmitters = await fetchApprovedSubmitters(roundId);
    const voters = await fetchVoters(roundId);

    const results = scoreRound(
      (await listForRound(roundId, requirement)).map((row) =>
        toRoundPlay(row, approvedSubmitters.has(row.user_id), voters.has(row.user_id))
      )
    );

    // THIS round only. The WHERE clause is the whole guarantee that a recompute cannot reach
    // another month, so it is a single equality on the id the caller named.
    await client.query('DELETE FROM round_dzpp WHERE round_id = $1', [roundId]);
    await insertRoundDzpp(client, roundId, results);

    const newTotal = results.reduce((sum, result) => sum + result.finalDzpp, 0);

    await client.query(
      `INSERT INTO dzpp_recomputes
         (round_id, previous_rows, new_rows, previous_total, new_total,
          previous_formula_version, new_formula_version, reason, recomputed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        roundId,
        previous.row_count,
        results.length,
        previous.total,
        newTotal,
        previous.version,
        DZPP_FORMULA_VERSION,
        reason,
        adminUserId,
      ]
    );

    // Covers the round that was never finalized at all, without moving the timestamp on one
    // that was.
    await client.query(
      'UPDATE rounds SET dzpp_finalized_at = COALESCE(dzpp_finalized_at, now()) WHERE id = $1',
      [roundId]
    );

    await client.query('COMMIT');
    return {
      ok: true,
      results,
      summary: {
        roundId,
        previousRows: previous.row_count,
        newRows: results.length,
        previousTotal: previous.total,
        newTotal,
        previousFormulaVersion: previous.version,
        newFormulaVersion: DZPP_FORMULA_VERSION,
        firstTime: previous.row_count === 0,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Completion sub-award helpers ─────────────────────────────────────────────
//
// Both read from the pool (not a transaction client) because they are called after the
// round has ended, at which point no write to submissions or votes for this round is
// possible. Using the pool avoids holding the transaction open across two extra round
// trips while still reading a consistent snapshot of a table that cannot change.

/** User ids that submitted an approved beatmap for the given round. */
async function fetchApprovedSubmitters(roundId: number): Promise<Set<number>> {
  const { rows } = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM submissions WHERE round_id = $1 AND status = 'approved'`,
    [roundId]
  );
  return new Set(rows.map((r) => r.user_id));
}

/** User ids that held a vote for the given round at the time of the call. */
async function fetchVoters(roundId: number): Promise<Set<number>> {
  const { rows } = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM votes WHERE round_id = $1`,
    [roundId]
  );
  return new Set(rows.map((r) => r.user_id));
}

/**
 * Writes a round's frozen rows. One statement per player, the way closeVoting writes its
 * tiebreak entries: a round's field is a handful of people, so a giant VALUES list would buy
 * nothing and cost readability.
 *
 * Shared by finalizeRound and recomputeRound so the column list exists once. Two copies of an
 * eleven-column INSERT is two things to keep in step, and the compiler would not catch it if
 * they drifted.
 *
 * The INSERT is plain rather than ON CONFLICT DO NOTHING in both callers: finalization is
 * guarded by the latch and a recompute deletes first, so a primary-key collision would mean one
 * of those guarantees had failed, and that should be loud.
 */
async function insertRoundDzpp(
  client: PoolClient,
  roundId: number,
  results: readonly DzppRoundResult[]
): Promise<void> {
  for (const result of results) {
    await client.query(
      `INSERT INTO round_dzpp
         (round_id, user_id, performance_value, completion_points, qualification_points,
          placement_points, placement, qualified, field_size, final_dzpp, formula_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        roundId,
        result.userId,
        result.performanceValue,
        result.completionPoints,
        result.qualificationPoints,
        result.placementPoints,
        result.placement,
        result.qualified,
        result.fieldSize,
        result.finalDzpp,
        result.formulaVersion,
      ]
    );
  }
}

export interface RecomputeRow {
  id: number;
  round_id: number;
  round_number: number;
  previous_rows: number;
  new_rows: number;
  previous_total: number;
  new_total: number;
  previous_formula_version: number | null;
  new_formula_version: number;
  reason: string;
  recomputed_by: number | null;
  recomputed_by_name: string | null;
  recomputed_at: Date;
}

/**
 * Every recompute applied to one round, newest first.
 *
 * LEFT JOIN on users for the same reason listCorrections does: the record has to survive the
 * administrator's account being deleted, so the name is optional and the row is not.
 */
export async function listRecomputes(roundId: number): Promise<RecomputeRow[]> {
  const { rows } = await pool.query<RecomputeRow>(
    `SELECT c.id, c.round_id, r.round_number, c.previous_rows, c.new_rows,
            c.previous_total, c.new_total, c.previous_formula_version, c.new_formula_version,
            c.reason, c.recomputed_by, u.username AS recomputed_by_name, c.recomputed_at
       FROM dzpp_recomputes c
       JOIN rounds r ON r.id = c.round_id
       LEFT JOIN users u ON u.id = c.recomputed_by
      WHERE c.round_id = $1
      ORDER BY c.recomputed_at DESC, c.id DESC`,
    [roundId]
  );
  return rows;
}

/** Maps a row to the ApiDzppRecompute DTO declared in src/api/client.ts. */
export function toApiDzppRecompute(row: RecomputeRow) {
  return {
    id: row.id,
    roundId: row.round_id,
    roundNumber: row.round_number,
    previousRows: row.previous_rows,
    newRows: row.new_rows,
    previousTotal: row.previous_total,
    newTotal: row.new_total,
    previousFormulaVersion: row.previous_formula_version,
    newFormulaVersion: row.new_formula_version,
    reason: row.reason,
    recomputedBy: row.recomputed_by,
    recomputedByName: row.recomputed_by_name,
    recomputedAt: row.recomputed_at.toISOString(),
  };
}

/**
 * Frozen DZPP for a set of rounds, as round id → user id → total.
 *
 * ONE QUERY FOR EVERY ROUND ASKED FOR, rather than one per round. The archive reads every month
 * the community has run, so a per-round lookup would grow a query per month forever — and the
 * archive already pays one query per round for its winner and one for its leaderboard, which is
 * enough of that pattern.
 *
 * These are the FROZEN values, read from round_dzpp rather than recomputed. An ended round's
 * DZPP is what was stored when it closed, and re-deriving it for display would put a second
 * answer on screen that could disagree with the ranking.
 */
export async function frozenDzpp(roundIds: number[]): Promise<Map<number, Map<number, number>>> {
  const byRound = new Map<number, Map<number, number>>();
  if (roundIds.length === 0) return byRound;

  const { rows } = await pool.query<{ round_id: number; user_id: number; final_dzpp: number }>(
    'SELECT round_id, user_id, final_dzpp FROM round_dzpp WHERE round_id = ANY($1::int[])',
    [roundIds]
  );

  for (const row of rows) {
    let round = byRound.get(row.round_id);
    if (round === undefined) {
      round = new Map<number, number>();
      byRound.set(row.round_id, round);
    }
    round.set(row.user_id, row.final_dzpp);
  }
  return byRound;
}
