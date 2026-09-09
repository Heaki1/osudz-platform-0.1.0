import { describe, expect, it } from 'vitest';
import { orderFor, qualifies, splitMods, toApiChallengeScore } from './challengeScores.js';

describe('splitMods', () => {
  it('reads a no-mod play as no mods, however it was written', () => {
    expect(splitMods('NM')).toEqual([]);
    expect(splitMods('')).toEqual([]);
    expect(splitMods('  nm ')).toEqual([]);
  });

  it('splits joined acronyms, which are always two characters', () => {
    expect(splitMods('HD')).toEqual(['HD']);
    expect(splitMods('HDHR')).toEqual(['HD', 'HR']);
    expect(splitMods('HDDT')).toEqual(['HD', 'DT']);
    expect(splitMods('hrdt')).toEqual(['HR', 'DT']);
  });

  // osu! attaches CL to plays set under the old scoring model. It is a scoring mode
  // rather than a gameplay mod, and counting it would make every classic play fail a
  // no-mod requirement for a reason no player would recognise.
  it('ignores the Classic marker', () => {
    expect(splitMods('CL')).toEqual([]);
    expect(splitMods('HDCL')).toEqual(['HD']);
  });
});

describe('qualifies', () => {
  const play = (mods: string, misses = 0) => ({ mods, misses });

  // FM (Free Mods): any combination of mods passes, including no mods at all.
  it('always passes mod compliance when the requirement is FM', () => {
    expect(qualifies(play('NM'),    { modRequirement: 'FM', challengeRequirement: 'Top #1 Score' })).toBe(true);
    expect(qualifies(play('HD'),    { modRequirement: 'FM', challengeRequirement: 'Top #1 Score' })).toBe(true);
    expect(qualifies(play('HDHR'), { modRequirement: 'FM', challengeRequirement: 'Top #1 Score' })).toBe(true);
    expect(qualifies(play('DT'),    { modRequirement: 'FM', challengeRequirement: 'Top #1 Score' })).toBe(true);
  });

  it('FM still checks the challenge requirement (Full Combo)', () => {
    expect(qualifies(play('HD', 0), { modRequirement: 'FM', challengeRequirement: 'Full Combo' })).toBe(true);
    expect(qualifies(play('HD', 1), { modRequirement: 'FM', challengeRequirement: 'Full Combo' })).toBe(false);
  });

  it('requires every named mod, and tolerates extras beyond them', () => {
    expect(qualifies(play('HDHR'), { modRequirement: 'HD', challengeRequirement: 'Top #1 Score' })).toBe(true);
    expect(qualifies(play('HD'),   { modRequirement: 'HDHR', challengeRequirement: 'Top #1 Score' })).toBe(false);
    expect(qualifies(play('HRHD'), { modRequirement: 'HDHR', challengeRequirement: 'Top #1 Score' })).toBe(true);
  });

  it('checks a full combo by misses, the one absolute requirement', () => {
    expect(qualifies(play('HD', 0), { modRequirement: 'HD', challengeRequirement: 'Full Combo' })).toBe(true);
    expect(qualifies(play('HD', 1), { modRequirement: 'HD', challengeRequirement: 'Full Combo' })).toBe(false);
  });

  it('lets a play with the right mods count for the relative requirements', () => {
    for (const requirement of ['Top #1 Score', 'Best Accuracy', 'Lowest Miss Count']) {
      expect(
        qualifies(play('HD', 12), { modRequirement: 'HD', challengeRequirement: requirement })
      ).toBe(true);
    }
  });

  it('refuses the wrong mods whatever the challenge requirement', () => {
    expect(
      qualifies(play('EZ', 0), { modRequirement: 'HD', challengeRequirement: 'Full Combo' })
    ).toBe(false);
  });
});

describe('orderFor', () => {
  it('puts the relative requirements in the order rather than in a flag', () => {
    expect(orderFor('Best Accuracy')).toContain('accuracy DESC');
    expect(orderFor('Lowest Miss Count')).toContain('misses ASC');
  });

  it('falls back to score descending, which the existing index covers', () => {
    expect(orderFor('Top #1 Score')).toContain('score DESC');
    expect(orderFor('Full Combo')).toContain('score DESC');
    expect(orderFor('')).toContain('score DESC');
  });
});

// ── The DTO's provisional DZPP ────────────────────────────────────────────────
//
// A regression guard rather than a driven test: the field was added with the column. What it
// pins is the part that is easy to get wrong later — that null survives as null instead of
// becoming a zero, and that the stored pp column does not leak onto a public DTO that never
// declared it.

describe('toApiChallengeScore', () => {
  const row = {
    id: 1,
    round_id: 3,
    user_id: 7,
    score: '32502940',
    accuracy: '97.54',
    misses: 0,
    mods: 'HD',
    qualified: true,
    pp: '325.24',
    osu_score_id: '5069480246',
    submitted_at: new Date('2026-09-05T12:00:00Z'),
    username: 'Heaki',
    osu_id: '4823510',
    avatar_url: null,
  };

  it('carries the DZPP the caller computed for the whole field', () => {
    expect(toApiChallengeScore(row, 1, 366).dzpp).toBe(366);
  });

  // A single-score read cannot know the qualified field size, so it passes null. Null has to
  // stay null: a zero would claim the play earned nothing, which is a different statement.
  it('keeps an unknown DZPP null rather than zero', () => {
    expect(toApiChallengeScore(row, 0, null).dzpp).toBeNull();
  });

  // pp is stored so the frozen row can be built from the same play the leaderboard showed. It
  // is not part of this DTO, and adding it would be an API change rather than a rename.
  it('does not put the stored pp column on the public DTO', () => {
    expect('pp' in toApiChallengeScore(row, 1, 366)).toBe(false);
  });

  it('converts the bigint and numeric columns the rest of the DTO reads', () => {
    const dto = toApiChallengeScore(row, 4, 200);
    expect(dto.rank).toBe(4);
    expect(dto.osuId).toBe(4823510);
    expect(dto.score).toBe(32502940);
    expect(dto.accuracy).toBe(97.54);
    expect(dto.osuScoreId).toBe(5069480246);
    expect(dto.avatarUrl).toBe('');
  });
});
