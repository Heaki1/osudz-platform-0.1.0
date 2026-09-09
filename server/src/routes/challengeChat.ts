// Challenge-phase live chat routes.
//
// GET    /api/challenge/chat      — public, messages for the open round
// POST   /api/challenge/chat      — requireAuth, post a message
// DELETE /api/challenge/chat/:id  — requireAdmin, delete any message
//
// The chat is ONLY served when the open round is in the challenge phase.
// The archive page never calls this endpoint.

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  findById,
  listForRound,
  post,
  remove,
  toApiChatMessage,
} from '../repo/challengeChat.js';
import { findCurrent } from '../repo/rounds.js';

const router = Router();

const MAX_BODY = 500;

/** 60 messages per minute per IP — a busy chat, not a flood. */
const chatLimit = rateLimit({ limit: 60, windowMs: 60_000, what: 'chat messages' });

// GET /api/challenge/chat
router.get('/', async (_req, res) => {
  try {
    const open = await findCurrent();
    if (!open || open.phase !== 'challenge') {
      res.json([]);
      return;
    }
    const rows = await listForRound(open.id);
    res.json(rows.map(toApiChatMessage));
  } catch (err) {
    console.error('[challenge-chat] read failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

// POST /api/challenge/chat
router.post('/', requireAuth, chatLimit, async (req, res) => {
  const { body } = (req.body ?? {}) as Record<string, unknown>;

  if (typeof body !== 'string' || body.trim() === '') {
    res.status(400).json({ error: 'Write something first' });
    return;
  }
  const text = body.trim();
  if (text.length > MAX_BODY) {
    res.status(400).json({ error: `A message can be at most ${MAX_BODY} characters` });
    return;
  }

  try {
    const open = await findCurrent();
    if (!open) {
      res.status(409).json({ error: 'No round is open' });
      return;
    }
    if (open.phase !== 'challenge') {
      res.status(409).json({ error: 'Chat is only available during the challenge phase' });
      return;
    }

    const row = await post({ roundId: open.id, userId: req.user!.id, body: text });
    if (!row) {
      res.status(503).json({ error: 'Could not save message' });
      return;
    }

    res.json({ ok: true, message: toApiChatMessage(row) });
  } catch (err) {
    console.error('[challenge-chat] post failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

// DELETE /api/challenge/chat/:id — admin only.
router.delete('/:id', requireAdmin, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    res.status(400).json({ error: 'Message id must be a positive integer' });
    return;
  }

  try {
    const msg = await findById(Number(req.params.id));
    if (!msg) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const removed = await remove(msg.id);
    res.json({ ok: removed });
  } catch (err) {
    console.error('[challenge-chat] delete failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

export default router;
