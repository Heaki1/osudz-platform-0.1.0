// Challenge-phase endpoints.
//
// The challenge is played on the round's winning beatmap, so every route here starts
// from the recorded winner rather than from anything the caller sends. A player cannot
// nominate which map their score counts for.
//
// Reads are public: the leaderboard is the point of the phase. Writing a score is gated
// by requireCanChallenge — see the note on POST /scores for what that rule actually is.

import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth, requireCanChallenge } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { findById as findRound, findCurrent } from '../repo/rounds.js';
import { findById as findSubmission } from '../repo/submissions.js';
import {
  findForUser,
  listForRound,
  qualifies,
  toApiChallengeScore,
  upsert,
} from '../repo/challengeScores.js';
import { scoreRound, toRoundPlay } from '../repo/dzpp.js';
import { ScoreNotFound, fetchUserScore } from '../services/osu.js';

const router = Router();

function fail(res: Response, err: unknown, where: string): void {
  console.error(`[challenge] ${where} failed:`, err instanceof Error ? err.message : err);
  res.status(503).json({ error: 'Database unavailable' });
}

/**
 * The round a request is about, and the entry the challenge is played on.
 *
 * roundId is optional so an archived round's leaderboard can be read; without it the
 * open round is used. The winner may be absent — a round can be archived from a phase
 * that never recorded one — and callers decide whether that is fatal.
 */
async function resolveChallenge(roundId: number | null) {
  const round = roundId === null ? await findCurrent() : await findRound(roundId);
  if (!round) return null;

  const winner =
    round.winning_submission_id === null ? null : await findSubmission(round.winning_submission_id);

  return { round, winner };
}

/** Parses ?roundId=. Returns undefined for a value that is not a positive integer. */
function readRoundId(raw: unknown): number | null | undefined {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

// GET /api/challenge/scores?roundId= — the leaderboard, best first.
//
// Ordering depends on the round's challenge requirement, because three of the four
// requirements are relative ('Top #1 Score', 'Best Accuracy', 'Lowest Miss Count') and
// so live in the order rather than in each row's qualified flag. See repo/
// challengeScores.ts. With no winner recorded there is no requirement to order by, so
// it falls back to score descending.
router.get('/scores', async (req, res) => {
  const roundId = readRoundId(req.query.roundId);
  if (roundId === undefined) {
    res.status(400).json({ error: 'roundId must be a positive integer' });
    return;
  }

  try {
    const context = await resolveChallenge(roundId);
    if (!context) {
      // No round to read. An empty leaderboard is the honest answer rather than a 404:
      // the dashboard asks for this on every load, including between rounds.
      res.json([]);
      return;
    }

    const rows = await listForRound(
      context.round.id,
      context.winner?.challenge_requirement ?? ''
    );
    // Provisional DZPP for the whole field, from the engine that will freeze it when the
    // round ends. rows is already in leaderboard order, which is exactly what scoreRound
    // needs — so the placements behind these numbers are the ones on screen.
    const provisional = new Map(
      scoreRound(rows.map(toRoundPlay)).map((result) => [result.userId, result.finalDzpp])
    );
    res.json(
      rows.map((row, i) => toApiChallengeScore(row, i + 1, provisional.get(row.user_id) ?? null))
    );
  } catch (err) {
    fail(res, err, 'leaderboard');
  }
});

// GET /api/challenge/my — the caller's own recorded score for the open round.
// 200 with a null body when they have not posted one, matching GET /votes/my.
router.get('/my', requireAuth, async (req, res) => {
  try {
    const round = await findCurrent();
    if (!round || !req.user) {
      res.json(null);
      return;
    }
    const row = await findForUser(round.id, req.user.id);
    // null DZPP: one row cannot know the qualified field size, and guessing it would put a
    // number on screen that the leaderboard would then contradict.
    res.json(row === null ? null : toApiChallengeScore(row, 0, null));
  } catch (err) {
    fail(res, err, 'my score');
  }
});

// POST /api/challenge/scores — import the caller's own osu! score for the winning map.
//
// The body is empty on purpose: the map comes from the round's recorded winner and the
// player from the session, so there is nothing for a caller to assert. The score is
// read from the osu! API with the application's own token — a play on a public beatmap
// is public data, verified before this was built (docs/todo.txt E2).
//
// ELIGIBILITY: the country allowlist, plus an unambiguous per-player override.
//
// The allowlist half is the E2 decision — the challenge is for the same community as the
// rest of the platform, so accounts outside the enabled countries read the leaderboard and
// comment but do not compete for the prize.
//
// The override half closes what C5 opened. Splitting participation into submitting and
// voting left the challenge belonging to neither, so a player an administrator had blocked
// from BOTH could still play the winning map and win the month's prize. Blocked from both is
// the only unambiguous way those two flags say "this account does not take part", so it now
// refuses here too; granted both is that statement inverted, so it grants here too; and a
// block on just one capability is left to mean only what it says. The rule is
// canEnterChallenge in repo/users.ts, derived from the two stored flags rather than a third
// column, and it is tested there.
//
// This one reaches the osu! API too, and a player refreshing after every attempt is a
// reasonable thing to do — so the limit is generous but present.
const importLimit = rateLimit({ limit: 20, windowMs: 60_000, what: 'score imports' });

router.post('/scores', requireCanChallenge, importLimit, async (req, res) => {
  try {
    const context = await resolveChallenge(null);
    if (!context) {
      res.status(409).json({ error: 'No round is open' });
      return;
    }

    const { round, winner } = context;
    if (round.phase !== 'challenge') {
      res.status(409).json({
        error: `This round is in the ${round.phase} phase, so there is no challenge to post a score to`,
      });
      return;
    }
    if (!winner) {
      res.status(409).json({ error: 'This round has no recorded winner, so there is no challenge map' });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    let play;
    try {
      play = await fetchUserScore(Number(winner.difficulty_id), Number(req.user.osu_id));
    } catch (err) {
      if (err instanceof ScoreNotFound) {
        res.status(404).json({
          error: 'osu! has no score for you on this beatmap yet. Set one and try again.',
        });
        return;
      }
      console.error('[challenge] osu! score fetch failed:', err instanceof Error ? err.message : err);
      res.status(503).json({ error: 'Could not reach the osu! API' });
      return;
    }

    const row = await upsert({
      roundId: round.id,
      userId: req.user.id,
      score: play.score,
      accuracy: play.accuracy,
      misses: play.misses,
      mods: play.mods,
      pp: play.pp,
      qualified: qualifies(play, {
        modRequirement: winner.mod_requirement,
        challengeRequirement: winner.challenge_requirement,
      }),
      osuScoreId: play.osuScoreId === 0 ? null : play.osuScoreId,
    });

    res.json({ ok: true, score: toApiChallengeScore(row, 0, null) });
  } catch (err) {
    fail(res, err, 'import score');
  }
});

export default router;
