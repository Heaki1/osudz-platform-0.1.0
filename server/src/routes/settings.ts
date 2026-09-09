// GET /api/settings — the submission rules, for everybody.
//
// docs/todo.txt C8 and C9. Public and read-only on purpose: these are the rules a player has
// to satisfy to enter a beatmap, so the submit page can state the real star and length limits
// and offer the real mod and challenge-type lists instead of a hardcoded copy that drifts the
// moment an administrator saves the tab.
//
// It carries the rules and nothing else — not updated_by, not updated_at. Who last changed a
// setting is administrative detail and belongs to GET /api/admin/settings.

import { Router } from 'express';
import { settings } from '../repo/siteSettings.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const rules = await settings();
    res.json({
      minStars: rules.minStars,
      maxStars: rules.maxStars,
      minLengthSeconds: rules.minLengthSeconds,
      maxLengthSeconds: rules.maxLengthSeconds,
      allowedStatuses: rules.allowedStatuses,
      allowedMods: rules.allowedMods,
      allowedChallengeTypes: rules.allowedChallengeTypes,
    });
  } catch (err) {
    console.error('[settings] read failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

export default router;
