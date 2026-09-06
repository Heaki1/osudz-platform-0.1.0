// GET /api/search/beatmaps — beatmap search over the osu! API.
//
// BEHIND requireAuth, AND THAT IS A TRADE WORTH NAMING. Every call spends one request
// from the application's osu! quota, which is exactly what made the beatmap lookup
// worth limiting (routes/submissions.ts), and the limiter in this project keys on the
// account: G3 refused IP keying because an IP is shared by a household or a campus. So
// a search open to the world would either be unlimited or be limited by the wrong key.
// Requiring a session costs a visitor nothing they could act on — searching exists to
// find a map to favorite or submit, and both of those already need one.
//
// requireAuth rather than a capability gate: reading is for everybody, whatever their
// country (docs/my_plan.txt), and a search is a read. The eligibility rule belongs on the
// write.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  isSearchSort,
  isSearchStatus,
  orderHits,
  searchBeatmapsets,
  type SearchFilters,
} from '../services/osu.js';

const router = Router();

/** The same ceiling as the beatmap lookup: both spend one osu! request per call. */
const searchLimit = rateLimit({ limit: 20, windowMs: 60_000, what: 'beatmap searches' });

/**
 * A numeric bound from the query string, or undefined when it was not asked for.
 *
 * Returns null for anything unusable so the route can answer 400. A silently dropped bound is a
 * search that quietly ignores what the player typed, which is worse than a refusal.
 */
function readBound(raw: unknown, max: number): number | null | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > max) return null;
  return value;
}

router.get('/beatmaps', requireAuth, searchLimit, async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const mapper = typeof req.query.mapper === 'string' ? req.query.mapper : '';
  const status = typeof req.query.status === 'string' ? req.query.status : 'any';
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'relevance';

  if (!isSearchStatus(status)) {
    res.status(400).json({ error: 'status must be ranked, loved, approved, or any' });
    return;
  }
  // Validated rather than defaulted quietly: a typo'd sort should be a 400, not a page
  // silently ordered by something the caller did not ask for.
  if (!isSearchSort(sort)) {
    res.status(400).json({ error: 'sort must be relevance, newest, stars, or bpm' });
    return;
  }

  // Ceilings rather than open numbers: osu! star ratings do not reach 20 and no beatmap runs at
  // 2000 BPM, so a value past either is a typo the player should be told about.
  const minStars = readBound(req.query.minStars, 20);
  const maxStars = readBound(req.query.maxStars, 20);
  const minBpm = readBound(req.query.minBpm, 2000);
  const maxBpm = readBound(req.query.maxBpm, 2000);

  // Named one by one rather than checked through Object.values, so each one narrows to
  // number | undefined for the rest of the handler.
  if (minStars === null || maxStars === null || minBpm === null || maxBpm === null) {
    res.status(400).json({
      error: 'Star and BPM bounds must be numbers — stars up to 20, BPM up to 2000',
    });
    return;
  }

  // An inverted range matches nothing, which would read as "no beatmaps found" rather than as the
  // mistake it is.
  if (
    (minStars !== undefined && maxStars !== undefined && minStars > maxStars) ||
    (minBpm !== undefined && maxBpm !== undefined && minBpm > maxBpm)
  ) {
    res.status(400).json({ error: 'The lower bound of a range cannot be above its upper bound' });
    return;
  }

  const filters: SearchFilters = { q: query, mapper, minStars, maxStars, minBpm, maxBpm };

  try {
    const hits = await searchBeatmapsets(filters, status, sort);
    res.json({ results: orderHits(hits, sort) });
  } catch (err) {
    // osu! being unavailable is not this server being broken, so it answers 503 with a
    // sentence a player can act on rather than the 500 the error handler would give.
    console.error('[api] beatmap search failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'osu! search is unavailable right now. Try again shortly.' });
  }
});

export default router;
