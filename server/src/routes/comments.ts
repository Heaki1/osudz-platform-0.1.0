// Comments on submissions.
//
// docs/todo.txt B8. THE ELIGIBILITY SPLIT IS THE POINT: reading and commenting are gated on
// requireAuth, not on either capability C5 defines. my_plan.txt:620-629 grants commenting to
// players who cannot vote — a non-eligible account is a member of the community with an
// opinion, and the roadmap says so explicitly.
//
// The read is public. my_plan.txt gives browsing to everybody, and a discussion nobody can see
// until they log in is not a discussion.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { create, listForRound, listForSubmission, toApiComment } from '../repo/comments.js';
import { findCurrent } from '../repo/rounds.js';

const router = Router();

/** Long enough for a real conversation, short enough to stop a paste-bomb. */
const MAX_BODY = 2000;

/**
 * Generous: a discussion is many small writes, and unlike the other limited routes this one
 * touches nothing outside the database — no osu! quota is at stake, only flood.
 */
const commentLimit = rateLimit({ limit: 30, windowMs: 60_000, what: 'comments' });

// GET /api/comments?roundId= | ?submissionId=
//
// The vote page asks for a whole round and groups by submission: one request for a page of a
// dozen cards rather than a dozen requests to render it.
router.get('/', async (req, res) => {
  const { roundId, submissionId } = req.query;

  const readId = (raw: unknown): number | null =>
    typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;

  try {
    if (submissionId !== undefined) {
      const id = readId(submissionId);
      if (id === null) {
        res.status(400).json({ error: 'submissionId must be a positive integer' });
        return;
      }
      res.json((await listForSubmission(id)).map(toApiComment));
      return;
    }

    let id = readId(roundId);
    if (roundId !== undefined && id === null) {
      res.status(400).json({ error: 'roundId must be a positive integer' });
      return;
    }
    if (id === null) {
      // No round open means no discussion yet, which is an empty list rather than a 404 for a
      // question that simply has no subject.
      const open = await findCurrent();
      if (!open) {
        res.json([]);
        return;
      }
      id = open.id;
    }

    res.json((await listForRound(id)).map(toApiComment));
  } catch (err) {
    console.error('[comments] read failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

router.post('/', requireAuth, commentLimit, async (req, res) => {
  const { submissionId, body, parentId } = (req.body ?? {}) as Record<string, unknown>;

  const target = Number(submissionId);
  if (!Number.isInteger(target) || target <= 0) {
    res.status(400).json({ error: 'submissionId must be a positive integer' });
    return;
  }

  if (typeof body !== 'string' || body.trim() === '') {
    res.status(400).json({ error: 'Write something first' });
    return;
  }
  const text = body.trim();
  if (text.length > MAX_BODY) {
    res.status(400).json({ error: `A comment can be at most ${MAX_BODY} characters` });
    return;
  }

  let parent: number | null = null;
  if (parentId !== undefined && parentId !== null) {
    const asNumber = Number(parentId);
    if (!Number.isInteger(asNumber) || asNumber <= 0) {
      res.status(400).json({ error: 'parentId must be a positive integer' });
      return;
    }
    parent = asNumber;
  }

  try {
    const row = await create({
      submissionId: target,
      userId: req.user!.id,
      body: text,
      parentId: parent,
    });

    // One answer for two causes, because the repo resolves both in a single statement: either
    // the submission does not exist, or the parent is not a comment on it. Both are "that is
    // not a place to comment", and distinguishing them would mean telling a caller which
    // submission ids exist.
    if (!row) {
      res.status(404).json({ error: 'That submission does not exist, or the reply target is not on it' });
      return;
    }

    res.json({ ok: true, comment: toApiComment(row) });
  } catch (err) {
    console.error('[comments] write failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

export default router;
