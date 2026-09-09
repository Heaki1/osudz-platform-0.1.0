import { describe, expect, it } from 'vitest';
import { checkBeatmapRules } from './siteSettings.js';

/** What migration 011 seeded: the three statuses, and no star or length limit at all. */
const seeded = {
  minStars: null,
  maxStars: null,
  minLengthSeconds: null,
  maxLengthSeconds: null,
  allowedStatuses: ['ranked', 'loved', 'approved'],
};

const map = (over: Partial<{ stars: number; lengthSeconds: number; mapStatus: string }> = {}) => ({
  stars: 5.67,
  lengthSeconds: 246,
  mapStatus: 'ranked',
  ...over,
});

describe('checkBeatmapRules', () => {
  // The seeded row has to accept everything the submit path accepted before C8, or applying
  // migration 011 would have changed behaviour on its own.
  it('accepts anything submittable under the seeded settings', () => {
    expect(checkBeatmapRules(map(), seeded)).toBeNull();
    expect(checkBeatmapRules(map({ stars: 0.5 }), seeded)).toBeNull();
    expect(checkBeatmapRules(map({ stars: 12 }), seeded)).toBeNull();
    expect(checkBeatmapRules(map({ lengthSeconds: 20 }), seeded)).toBeNull();
    expect(checkBeatmapRules(map({ mapStatus: 'loved' }), seeded)).toBeNull();
  });

  it('refuses a status the administrator has turned off', () => {
    const rules = { ...seeded, allowedStatuses: ['ranked'] };
    expect(checkBeatmapRules(map({ mapStatus: 'loved' }), rules)).toMatch(/Only Ranked/);
    expect(checkBeatmapRules(map({ mapStatus: 'ranked' }), rules)).toBeNull();
  });

  it('names the statuses that are allowed, so the refusal is actionable', () => {
    const rules = { ...seeded, allowedStatuses: ['ranked', 'loved'] };
    expect(checkBeatmapRules(map({ mapStatus: 'approved' }), rules)).toBe(
      'This beatmap is approved. Only Ranked, Loved beatmaps can be submitted this round.'
    );
  });

  it('says so plainly when no status is accepted at all', () => {
    const rules = { ...seeded, allowedStatuses: [] };
    expect(checkBeatmapRules(map(), rules)).toMatch(/No beatmap status/);
  });

  it('enforces both star bounds, inclusively', () => {
    const rules = { ...seeded, minStars: 4, maxStars: 6 };
    expect(checkBeatmapRules(map({ stars: 4 }), rules)).toBeNull();
    expect(checkBeatmapRules(map({ stars: 6 }), rules)).toBeNull();
    expect(checkBeatmapRules(map({ stars: 3.99 }), rules)).toMatch(/below the 4.00/);
    expect(checkBeatmapRules(map({ stars: 6.01 }), rules)).toMatch(/above the 6.00/);
  });

  it('enforces both length bounds, and reports them as minutes and seconds', () => {
    const rules = { ...seeded, minLengthSeconds: 60, maxLengthSeconds: 300 };
    expect(checkBeatmapRules(map({ lengthSeconds: 60 }), rules)).toBeNull();
    expect(checkBeatmapRules(map({ lengthSeconds: 59 }), rules)).toBe(
      'This beatmap is 0:59 long, under the 1:00 minimum.'
    );
    expect(checkBeatmapRules(map({ lengthSeconds: 301 }), rules)).toBe(
      'This beatmap is 5:01 long, over the 5:00 maximum.'
    );
  });

  // One sentence, not a list: the player fixes one thing at a time, and status is the rule
  // they cannot fix at all, so it has to be the one they are told about first.
  it('reports the status before a bound when both are broken', () => {
    const rules = { ...seeded, allowedStatuses: ['ranked'], minStars: 9 };
    expect(checkBeatmapRules(map({ mapStatus: 'loved', stars: 2 }), rules)).toMatch(/Only Ranked/);
  });

  it('treats a null bound as no bound rather than as zero', () => {
    expect(checkBeatmapRules(map({ stars: 0 }), { ...seeded, minStars: null })).toBeNull();
    expect(checkBeatmapRules(map({ lengthSeconds: 0 }), { ...seeded, maxLengthSeconds: null })).toBeNull();
  });
});
