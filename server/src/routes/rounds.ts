// Read-only round endpoints. Every write lives in routes/admin.ts behind
// requireAdmin, so nothing here needs a session.

import { Router } from 'express';
import type { Response } from 'express';
import {
  findById,
  findCurrent,
  listAll,
  participantCounts,
  toApiRound,
  type RoundRow,
} from '../repo/rounds.js';
import { findById as findSubmission, toApiSubmission } from '../repo/submissions.js';
import { listForRound, toApiChallengeScore } from '../repo/challengeScores.js';
import { frozenDzpp } from '../repo/dzpp.js';

const router = Router();

function dbDown(res: Response, err: unknown, where: string): void {
  console.error(`[rounds] ${where} failed:`, err instanceof Error ? err.message : err);
  res.status(503).json({ error: 'Database unavailable' });
}

/**
 * A round with everything the archive shows: the entry recorded as its winner, that
 * round's challenge leaderboard, and how many people took part.
 *
 * The winner is read by id and never recomputed from the vote table — it is the entry
 * an administrator approved, and a later retraction or rejection does not move it. It
 * comes back as a whole submission rather than an id because the archive shows the map,
 * and would otherwise need a request per round. winner_status says how far it has got,
 * so the row is returned whether pending or official; a tied round has none yet.
 *
 * One query per round for the winner and one for its leaderboard. That is deliberate:
 * the leaderboard's ORDER depends on that round's own challenge requirement, and
 * routing every read through listForRound keeps exactly one implementation of that
 * ordering rather than a second one in JavaScript that could drift from it. The archive
 * holds one row per month the community has run, so the count is small and bounded.
 */
async function toRoundDetail(
  row: RoundRow,
  participants: number,
  frozen: Map<number, number>
) {
  const winner =
    row.winning_submission_id === null ? null : await findSubmission(row.winning_submission_id);

  const scores = await listForRound(row.id, winner?.challenge_requirement ?? '');

  return {
    ...toApiRound(row),
    winner: winner ? toApiSubmission(winner) : null,
    // THE FROZEN VALUES, read from round_dzpp rather than recomputed. An ended round's DZPP is
    // what was stored when it closed; re-deriving it here would put a second answer on the
    // archive that could disagree with the ranking. A round with nothing frozen — an open one,
    // or one that ended before the pipeline existed — reads null, which the page shows as a dash
    // rather than as a zero.
    leaderboard: scores.map((score, i) =>
      toApiChallengeScore(score, i + 1, frozen.get(score.user_id) ?? null)
    ),
    participants,
  };
}

// GET /api/rounds/current — the open round, or null when none is running.
// Declared before /:id so "current" is never parsed as an id.
//
// Deliberately lean: no winner, no leaderboard. Every page loads this on every render,
// and the two callers that want the detail ask for it by id.
router.get('/current', async (_req, res) => {
  try {
    const row = await findCurrent();
    res.json(row ? toApiRound(row) : null);
  } catch (err) {
    dbDown(res, err, 'current');
  }
});

// GET /api/rounds — every round, newest first, in full. This is the archive.
router.get('/', async (_req, res) => {
  try {
    const rows = await listAll();
    const ids = rows.map((row) => row.id);
    // Both are one query for the whole archive rather than one per round.
    const [counts, frozen] = await Promise.all([participantCounts(ids), frozenDzpp(ids)]);
    const detailed = await Promise.all(
      rows.map((row) =>
        toRoundDetail(row, counts.get(row.id) ?? 0, frozen.get(row.id) ?? new Map())
      )
    );
    res.json(detailed);
  } catch (err) {
    dbDown(res, err, 'list');
  }
});

// GET /api/rounds/:id — one round, in the same shape as the list.
router.get('/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    res.status(400).json({ error: 'Round id must be a positive integer' });
    return;
  }

  try {
    const row = await findById(Number(req.params.id));
    if (!row) {
      res.status(404).json({ error: 'Round not found' });
      return;
    }

    const [counts, frozen] = await Promise.all([
      participantCounts([row.id]),
      frozenDzpp([row.id]),
    ]);
    res.json(
      await toRoundDetail(row, counts.get(row.id) ?? 0, frozen.get(row.id) ?? new Map())
    );
  } catch (err) {
    dbDown(res, err, 'get');
  }
});

export default router;
