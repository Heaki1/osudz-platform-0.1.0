// Vote endpoints.
//
// One vote per user per round, cast during the voting phase only. The database
// enforces the "one" (votes_one_per_user_per_round) and requireCanVote enforces
// the "who". Everything else is checked here, because the votes table deliberately
// carries no composite foreign key tying a vote's submission to its round, no check
// that the target was ever approved, and no self-vote constraint — so a crafted
// request that skipped these would be written and then counted by the COUNT(*)
// tally in repo/submissions.ts.
//
// Authorisation is rounds.phase and nothing else. The *_ends_at columns are a
// schedule, not a clock (repo/rounds.ts): a countdown that has run out does not
// close voting, and a future one does not open it.

import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth, requireCanVote } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { findCurrent } from '../repo/rounds.js';
import { findById } from '../repo/submissions.js';
import { cast, findByUserAndRound, retract } from '../repo/votes.js';

const router = Router();

function fail(res: Response, err: unknown, where: string): void {
  console.error(`[votes] ${where} failed:`, err instanceof Error ? err.message : err);
  res.status(503).json({ error: 'Something went wrong recording your vote. Try again.' });
}

/** Names the phase in the refusal, the way routes/submissions.ts does. */
const closedInPhase = (phase: string): string =>
  `Voting is closed — this round is in the ${phase} phase`;

/**
 * The ballot closes when a winner is computed, not when the phase moves on. The
 * phase stays 'voting' while the winner is pending or tied, so both casting and
 * retracting stop here: winner_vote_count and total_votes are frozen at that moment
 * and a late withdrawal would leave the recorded result disagreeing with the votes
 * table.
 */
const BALLOT_CLOSED = 'Voting has closed for this round while the winner is confirmed';

// GET /api/votes/my — the caller's vote in the open round, or null.
//
// Answers 200 with a null body rather than 404 when there is no vote. The client's
// get() maps every non-2xx response to null (src/api/client.ts), so a 404 here
// would be indistinguishable from "you have not voted" — and a real failure should
// not quietly read as that.
router.get('/my', requireAuth, async (req, res) => {
  try {
    const round = await findCurrent();
    if (!round) {
      res.json(null);
      return;
    }

    // requireAuth guarantees req.user, but the type does not know that.
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const vote = await findByUserAndRound(user.id, round.id);
    res.json(vote ? { submissionId: vote.submission_id } : null);
  } catch (err) {
    fail(res, err, 'my vote');
  }
});

// POST /api/votes — cast a vote, or move an existing one to another submission.
// Requires an eligible session, the voting phase, and an approved entry in the open
// round that the caller did not submit themselves.
// One limiter shared by casting and retracting, because moving a vote is one of each
// and the pair is what a churning client produces. Thirty a minute leaves room to change
// your mind repeatedly while browsing and still stops a loop.
const voteLimit = rateLimit({ limit: 30, windowMs: 60_000, what: 'vote changes' });

router.post('/', requireCanVote, voteLimit, async (req, res) => {
  const { submissionId } = (req.body ?? {}) as { submissionId?: unknown };
  const id =
    typeof submissionId === 'number' || typeof submissionId === 'string'
      ? Number(submissionId)
      : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'submissionId must be a submission id' });
    return;
  }

  try {
    const round = await findCurrent();
    if (!round) {
      res.status(409).json({ error: 'No round is open' });
      return;
    }
    if (round.phase !== 'voting') {
      res.status(409).json({ error: closedInPhase(round.phase) });
      return;
    }
    if (round.winner_status !== 'none') {
      res.status(409).json({ error: BALLOT_CLOSED });
      return;
    }

    // requireCanVote guarantees req.user, but the type does not know that.
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const submission = await findById(id);
    if (!submission) {
      res.status(404).json({ error: 'That submission does not exist' });
      return;
    }
    // A vote names a submission, and the submission names a round; without this the
    // schema would happily record a vote in this round for last round's entry.
    if (submission.round_id !== round.id) {
      res.status(409).json({ error: 'That submission is not in the open round' });
      return;
    }
    // GET /api/submissions hides unapproved rows, which hides them from the UI but
    // not from a hand-written request.
    if (submission.status !== 'approved') {
      res.status(409).json({ error: 'That submission has not been approved for voting' });
      return;
    }
    if (submission.user_id === user.id) {
      res.status(409).json({ error: 'You cannot vote for your own submission' });
      return;
    }

    await cast(round.id, user.id, id);
    res.json({ ok: true, submissionId: id });
  } catch (err) {
    // 23503 = foreign_key_violation, if the submission was deleted between the read
    // above and the insert.
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23503') {
      res.status(404).json({ error: 'That submission does not exist' });
      return;
    }
    fail(res, err, 'cast');
  }
});

// DELETE /api/votes — withdraw the caller's vote.
//
// requireAuth rather than requireCanVote: someone whose osu! profile country
// changed after they voted must still be able to take back the vote they hold.
router.delete('/', requireAuth, voteLimit, async (req, res) => {
  try {
    const round = await findCurrent();
    if (!round) {
      res.status(409).json({ error: 'No round is open' });
      return;
    }
    if (round.phase !== 'voting') {
      res.status(409).json({ error: closedInPhase(round.phase) });
      return;
    }
    if (round.winner_status !== 'none') {
      res.status(409).json({ error: BALLOT_CLOSED });
      return;
    }

    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Idempotent — retracting a vote that is not there is not an error.
    await retract(user.id, round.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'retract');
  }
});

export default router;
