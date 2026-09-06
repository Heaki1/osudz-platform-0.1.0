import { describe, expect, it } from 'vitest';
import {
  isSearchStatus,
  orderHits,
  parseDifficultyId,
  pickDifficulty,
  type OsuSearchHit,
  buildSearchQuery,
  withinRange,
} from './osu.js';

describe('parseDifficultyId', () => {
  it('accepts every osu! link shape a player might paste', () => {
    expect(parseDifficultyId('https://osu.ppy.sh/beatmapsets/41823#osu/131891')).toBe(131891);
    expect(parseDifficultyId('https://osu.ppy.sh/beatmapsets/41823/131891')).toBe(131891);
    expect(parseDifficultyId('https://osu.ppy.sh/beatmaps/131891')).toBe(131891);
    expect(parseDifficultyId('https://osu.ppy.sh/b/131891')).toBe(131891);
    expect(parseDifficultyId('131891')).toBe(131891);
    expect(parseDifficultyId('  131891  ')).toBe(131891);
  });

  it('reads the difficulty, not the set, when a link carries both', () => {
    expect(parseDifficultyId('https://osu.ppy.sh/beatmapsets/41823#taiko/131891')).toBe(131891);
  });

  // A submission is one difficulty. A set-only link does not name which, and guessing
  // would enter a beatmap the player did not choose.
  it('refuses a link that names only a beatmapset', () => {
    expect(parseDifficultyId('https://osu.ppy.sh/beatmapsets/41823')).toBeNull();
  });

  it('refuses anything that is not a link or an id', () => {
    expect(parseDifficultyId('')).toBeNull();
    expect(parseDifficultyId('Souzou Forest')).toBeNull();
    expect(parseDifficultyId('https://example.com/nope')).toBeNull();
  });
});

describe('pickDifficulty', () => {
  // A search card represents its set by the hardest difficulty. With a dozen
  // difficulties per set, one card each would bury every other result on the page.
  it('picks the highest star rating in the set', () => {
    const picked = pickDifficulty([
      { id: 1, difficulty_rating: 4.2 },
      { id: 2, difficulty_rating: 6.8 },
      { id: 3, difficulty_rating: 5.1 },
    ]);
    expect(picked?.id).toBe(2);
  });

  it('skips an entry with no usable id rather than picking it', () => {
    const picked = pickDifficulty([
      { difficulty_rating: 9.9 },
      { id: 5, difficulty_rating: 2 },
    ]);
    expect(picked?.id).toBe(5);
  });

  // A set that resolves to nothing is what makes the whole hit skippable, so this
  // returning null is load-bearing rather than defensive.
  it('is null when nothing in the set is usable', () => {
    expect(pickDifficulty([])).toBeNull();
    expect(pickDifficulty([{ difficulty_rating: 5 }])).toBeNull();
    expect(pickDifficulty(undefined)).toBeNull();
    expect(pickDifficulty('not an array')).toBeNull();
  });

  // A difficulty with no star rating cannot fill a card — OsuSearchHit requires one —
  // so it is not a candidate for representing the set. Tolerating it here would only
  // move the rejection into toSearchHit.
  it('skips a difficulty that reports no star rating', () => {
    expect(pickDifficulty([{ id: 11 }, { id: 12 }])).toBeNull();
    expect(pickDifficulty([{ id: 11 }, { id: 12, difficulty_rating: 3.3 }])?.id).toBe(12);
  });
});

describe('isSearchStatus', () => {
  it('accepts any, and the three statuses a submission may use', () => {
    expect(isSearchStatus('any')).toBe(true);
    expect(isSearchStatus('ranked')).toBe(true);
    expect(isSearchStatus('loved')).toBe(true);
    expect(isSearchStatus('approved')).toBe(true);
  });

  // The route answers 400 on these. Search offers what can be entered, so a status
  // the submit path refuses is not a narrower search but a misleading one.
  it('refuses statuses the submit path would refuse', () => {
    expect(isSearchStatus('qualified')).toBe(false);
    expect(isSearchStatus('graveyard')).toBe(false);
    expect(isSearchStatus('pending')).toBe(false);
    expect(isSearchStatus('')).toBe(false);
    expect(isSearchStatus(undefined)).toBe(false);
  });
});

describe('orderHits', () => {
  const hit = (stars: number, bpm: number): OsuSearchHit => ({
    difficultyId: Math.round(stars * 100),
    beatmapsetId: 1,
    title: 'title',
    artist: 'artist',
    mapper: 'mapper',
    difficultyName: 'Expert',
    mapStatus: 'ranked',
    coverUrl: '',
    previewUrl: '',
    stars,
    bpm,
    lengthSeconds: 120,
    difficultyCount: 1,
  });

  it('orders by stars, hardest first', () => {
    const ordered = orderHits([hit(4, 200), hit(7, 150), hit(5.5, 180)], 'stars');
    expect(ordered.map((h) => h.stars)).toEqual([7, 5.5, 4]);
  });

  // osu! search cannot sort by BPM at all, so this ordering is the only one there is
  // and it covers the page that came back rather than every match.
  it('orders by bpm, fastest first', () => {
    const ordered = orderHits([hit(4, 200), hit(7, 150), hit(5.5, 180)], 'bpm');
    expect(ordered.map((h) => h.bpm)).toEqual([200, 180, 150]);
  });

  it('leaves the array it was given alone', () => {
    const hits = [hit(4, 200), hit(7, 150)];
    orderHits(hits, 'stars');
    expect(hits.map((h) => h.stars)).toEqual([4, 7]);
  });
});

// ── Search filters ───────────────────────────────────────────────────────────
//
// osu! search takes its advanced filters INSIDE the q string, in its own little query
// language: `creator=x`, `stars>=5`, `bpm<=200`. Composing that is the whole of
// buildSearchQuery, and it is worth testing because a malformed clause does not error — osu!
// treats it as free text and quietly returns the wrong results.

describe('buildSearchQuery', () => {
  it('is empty when nothing was asked for', () => {
    expect(buildSearchQuery({})).toBe('');
    expect(buildSearchQuery({ q: '   ', mapper: '' })).toBe('');
  });

  it('passes free text through, trimmed', () => {
    expect(buildSearchQuery({ q: '  freedom dive  ' })).toBe('freedom dive');
  });

  it('turns a mapper into the creator clause osu! understands', () => {
    expect(buildSearchQuery({ mapper: 'peppy' })).toBe('creator=peppy');
  });

  // A value with a space would otherwise split into a clause and a stray word.
  it('quotes a mapper name containing whitespace', () => {
    expect(buildSearchQuery({ mapper: 'Sotarks Two' })).toBe('creator="Sotarks Two"');
  });

  it('expresses a star range as two bounded clauses', () => {
    expect(buildSearchQuery({ minStars: 5 })).toBe('stars>=5');
    expect(buildSearchQuery({ maxStars: 6.5 })).toBe('stars<=6.5');
    expect(buildSearchQuery({ minStars: 5, maxStars: 6.5 })).toBe('stars>=5 stars<=6.5');
  });

  it('expresses a BPM range the same way', () => {
    expect(buildSearchQuery({ minBpm: 180, maxBpm: 200 })).toBe('bpm>=180 bpm<=200');
  });

  it('joins every clause it was given, free text first', () => {
    expect(
      buildSearchQuery({ q: 'dive', mapper: 'peppy', minStars: 5, maxStars: 6, minBpm: 180, maxBpm: 200 })
    ).toBe('dive creator=peppy stars>=5 stars<=6 bpm>=180 bpm<=200');
  });

  // A bound that is not a finite number is not a bound. It cannot come from the route, which
  // validates first, so this keeps the helper total rather than trusting the caller.
  it('ignores a bound that is not a usable number', () => {
    expect(buildSearchQuery({ minStars: Number.NaN, maxBpm: Number.POSITIVE_INFINITY })).toBe('');
  });
});

describe('withinRange', () => {
  const hit = { stars: 5.5, bpm: 190 };

  it('accepts a hit when no bound was given', () => {
    expect(withinRange(hit, {})).toBe(true);
  });

  it('treats both bounds as inclusive', () => {
    expect(withinRange(hit, { minStars: 5.5, maxStars: 5.5 })).toBe(true);
    expect(withinRange(hit, { minBpm: 190, maxBpm: 190 })).toBe(true);
  });

  it('rejects a hit outside either range', () => {
    expect(withinRange(hit, { minStars: 6 })).toBe(false);
    expect(withinRange(hit, { maxStars: 5 })).toBe(false);
    expect(withinRange(hit, { minBpm: 200 })).toBe(false);
    expect(withinRange(hit, { maxBpm: 180 })).toBe(false);
  });

  // The local filter is a second line of defence behind the q clauses, so it must agree with
  // them rather than narrow further: an unusable bound is no bound in both places.
  it('ignores a bound that is not a usable number', () => {
    expect(withinRange(hit, { minStars: Number.NaN })).toBe(true);
  });
});

// ── Range-aware difficulty pick ──────────────────────────────────────────────
//
// A card represents its set by ONE difficulty, and osu! matches a set when ANY of its
// difficulties fits the filter. Represent the set by its hardest difficulty regardless, and a
// 3-4 star search shows a card reading 7.2 stars — which looks broken rather than clever. So
// when a star range was asked for, the set is represented by the hardest difficulty INSIDE it.

describe('pickDifficulty with a star range', () => {
  const set = [
    { id: 1, difficulty_rating: 2.4 },
    { id: 2, difficulty_rating: 3.6 },
    { id: 3, difficulty_rating: 7.2 },
  ];

  it('picks the hardest difficulty inside the range, not the hardest overall', () => {
    expect(pickDifficulty(set, { minStars: 3, maxStars: 4 })?.id).toBe(2);
  });

  it('honours a lower bound alone', () => {
    expect(pickDifficulty(set, { minStars: 3 })?.id).toBe(3);
  });

  it('honours an upper bound alone', () => {
    expect(pickDifficulty(set, { maxStars: 4 })?.id).toBe(2);
  });

  // Falls back rather than returning null, so the decision to drop the hit stays with the
  // caller's own range filter and there is one place that says no.
  it('falls back to the hardest overall when nothing is inside the range', () => {
    expect(pickDifficulty(set, { minStars: 8 })?.id).toBe(3);
  });

  it('is unchanged when no range is given', () => {
    expect(pickDifficulty(set)?.id).toBe(3);
    expect(pickDifficulty(set, {})?.id).toBe(3);
  });
});

// ── Sorting ──────────────────────────────────────────────────────────────────

describe('orderHits with the four sorts', () => {
  const hits = [
    { stars: 4, bpm: 200, title: 'a' },
    { stars: 7, bpm: 150, title: 'b' },
    { stars: 5, bpm: 180, title: 'c' },
  ] as unknown as Parameters<typeof orderHits>[0];

  it('orders by stars descending', () => {
    expect(orderHits(hits, 'stars').map((h) => h.stars)).toEqual([7, 5, 4]);
  });

  it('orders by BPM descending', () => {
    expect(orderHits(hits, 'bpm').map((h) => h.bpm)).toEqual([200, 180, 150]);
  });

  // osu! already ordered these, and it is the only party that knows what relevance or a
  // ranked date means. Re-ordering them here would throw that away.
  it('leaves the osu! order alone for relevance and newest', () => {
    expect(orderHits(hits, 'relevance').map((h) => h.stars)).toEqual([4, 7, 5]);
    expect(orderHits(hits, 'newest').map((h) => h.stars)).toEqual([4, 7, 5]);
  });

  it('never mutates the array it was given', () => {
    const before = hits.map((h) => h.stars);
    orderHits(hits, 'stars');
    expect(hits.map((h) => h.stars)).toEqual(before);
  });
});
