import { describe, expect, it } from 'vitest';
import {
  COMPLETION_POINTS,
  DZPP_FORMULA_VERSION,
  FIELD_FACTOR_TARGET,
  PLACEMENT_TABLE,
  QUALIFICATION_POINTS,
  RANKING_COUNTRY,
  basePlacementPoints,
  fieldFactor,
  placementPoints,
  refuseFinalize,
  refuseRecompute,
  scoreOne,
  scoreRound,
  toApiPlayerDzppRound,
  toApiRankingEntry,
  toRoundPlay,
  type DzppRoundPlay,
  type DzppScoreInput,
} from './dzpp.js';

// The numbers the specification froze. This test exists so that changing one of them is
// never an accident: a constant is a policy decision that needs a new formula version,
// not an edit.
describe('the approved constants', () => {
  it('holds the values docs/superpowers/specs/2026-09-05-dzpp-design.md froze', () => {
    expect(COMPLETION_POINTS).toBe(10);
    expect(QUALIFICATION_POINTS).toBe(25);
    expect(FIELD_FACTOR_TARGET).toBe(8);
    expect(DZPP_FORMULA_VERSION).toBe(1);
    expect([...PLACEMENT_TABLE]).toEqual([50, 40, 30, 25, 20, 15, 10, 5]);
  });
});

describe('fieldFactor', () => {
  // Every value is an exact eighth, which is why toBe rather than toBeCloseTo is honest
  // here: eighths are exact in binary floating point, so any drift is a real bug.
  it('is an exact eighth for every field short of the target', () => {
    expect(fieldFactor(1)).toBe(0.125);
    expect(fieldFactor(2)).toBe(0.25);
    expect(fieldFactor(3)).toBe(0.375);
    expect(fieldFactor(4)).toBe(0.5);
    expect(fieldFactor(5)).toBe(0.625);
    expect(fieldFactor(6)).toBe(0.75);
    expect(fieldFactor(7)).toBe(0.875);
  });

  it('reaches 1 at the target and never exceeds it', () => {
    expect(fieldFactor(8)).toBe(1);
    expect(fieldFactor(9)).toBe(1);
    expect(fieldFactor(20)).toBe(1);
    expect(fieldFactor(500)).toBe(1);
  });

  // A round where nobody qualified. Nobody can be placed either, so the factor never
  // reaches a real award — but returning 0 rather than something negative keeps the
  // function total.
  it('is 0 for an empty field', () => {
    expect(fieldFactor(0)).toBe(0);
    expect(fieldFactor(-3)).toBe(0);
  });
});

describe('basePlacementPoints', () => {
  it('pays the table for the first eight places', () => {
    expect(basePlacementPoints(1)).toBe(50);
    expect(basePlacementPoints(2)).toBe(40);
    expect(basePlacementPoints(3)).toBe(30);
    expect(basePlacementPoints(4)).toBe(25);
    expect(basePlacementPoints(5)).toBe(20);
    expect(basePlacementPoints(6)).toBe(15);
    expect(basePlacementPoints(7)).toBe(10);
    expect(basePlacementPoints(8)).toBe(5);
  });

  it('pays nothing from ninth place down', () => {
    expect(basePlacementPoints(9)).toBe(0);
    expect(basePlacementPoints(10)).toBe(0);
    expect(basePlacementPoints(20)).toBe(0);
  });

  // Not reachable through scoreRound, which numbers from 1. Guarded so a future caller
  // cannot turn a bad placement into points.
  it('pays nothing for a placement that is not a place', () => {
    expect(basePlacementPoints(0)).toBe(0);
    expect(basePlacementPoints(-1)).toBe(0);
    expect(basePlacementPoints(1.5)).toBe(0);
  });
});

describe('placementPoints', () => {
  it('pays the table in full once the field reaches eight', () => {
    expect(placementPoints(1, 8)).toBe(50);
    expect(placementPoints(8, 8)).toBe(5);
    expect(placementPoints(1, 20)).toBe(50);
    expect(placementPoints(9, 20)).toBe(0);
  });

  // The worked examples in section 5 of the specification.
  it('scales the table by the field factor on a thin field', () => {
    expect(placementPoints(1, 3)).toBe(18.75);
    expect(placementPoints(2, 3)).toBe(15);
    expect(placementPoints(3, 3)).toBe(11.25);
  });

  it('reaches its smallest non-zero awards at the edges of a thin field', () => {
    expect(placementPoints(1, 1)).toBe(6.25);
    expect(placementPoints(7, 7)).toBe(8.75);
  });

  it('pays nothing when the placement is past the table, whatever the field', () => {
    expect(placementPoints(9, 3)).toBe(0);
    expect(placementPoints(12, 20)).toBe(0);
  });
});

// ── scoreOne ─────────────────────────────────────────────────────────────────
//
// One player, one round. The caller only reaches this for a play that exists: a player
// with no challenge_scores row has no breakdown and no frozen row at all, which is why
// completion is unconditional here.

describe('scoreOne', () => {
  const play = (over: Partial<DzppScoreInput> = {}): DzppScoreInput => ({
    pp: 100,
    qualified: true,
    placement: 1,
    qualifiedPlayers: 8,
    ...over,
  });

  it('sums performance, completion, qualification and placement', () => {
    const result = scoreOne(play({ pp: 331.2, placement: 1, qualifiedPlayers: 8 }));
    expect(result.performanceValue).toBe(331.2);
    expect(result.completionPoints).toBe(10);
    expect(result.qualificationPoints).toBe(25);
    expect(result.placementPoints).toBe(50);
    expect(result.finalDzpp).toBe(416);
  });

  it('reports the field size and the formula version it scored under', () => {
    const result = scoreOne(play({ qualifiedPlayers: 3 }));
    expect(result.fieldSize).toBe(3);
    expect(result.formulaVersion).toBe(DZPP_FORMULA_VERSION);
  });

  // A non-qualifying play still earns the completion award: turning up and failing the
  // terms is worth more than not turning up, and less than doing it properly.
  it('pays a non-qualifying play its completion award and nothing else', () => {
    const result = scoreOne(play({ pp: 268.75, qualified: false, placement: null }));
    expect(result.qualificationPoints).toBe(0);
    expect(result.placementPoints).toBe(0);
    expect(result.placement).toBeNull();
    expect(result.finalDzpp).toBe(279);
  });

  // Only qualified players receive placement points. A placement handed in alongside
  // qualified: false is a caller bug, and it must not become points.
  it('refuses placement points to a play that did not qualify', () => {
    const result = scoreOne(play({ qualified: false, placement: 1 }));
    expect(result.placementPoints).toBe(0);
    expect(result.placement).toBeNull();
  });

  it('pays no placement points when there is no placement', () => {
    const result = scoreOne(play({ placement: null }));
    expect(result.placementPoints).toBe(0);
    expect(result.finalDzpp).toBe(135);
  });

  // The Loved-map case. osu! awards no pp on a Loved beatmap, so the term is absent
  // rather than zero — and the round is scored on the other three terms alone.
  it('treats an absent performance value as absent, not as zero points earned', () => {
    const result = scoreOne(play({ pp: null, placement: 1, qualifiedPlayers: 20 }));
    expect(result.performanceValue).toBeNull();
    expect(result.finalDzpp).toBe(85);
  });

  it('keeps a genuine zero-pp play distinct from an absent one', () => {
    const result = scoreOne(play({ pp: 0, placement: 1, qualifiedPlayers: 20 }));
    expect(result.performanceValue).toBe(0);
    expect(result.finalDzpp).toBe(85);
  });

  // osu! cannot report either of these. Reading them as "no value" keeps a bad number out
  // of numeric(8,2) and out of the total, instead of storing a NaN or subtracting DZPP.
  it('reads an impossible performance value as absent', () => {
    expect(scoreOne(play({ pp: Number.NaN })).performanceValue).toBeNull();
    expect(scoreOne(play({ pp: Number.POSITIVE_INFINITY })).performanceValue).toBeNull();
    expect(scoreOne(play({ pp: -5 })).performanceValue).toBeNull();
    expect(scoreOne(play({ pp: -5, placement: 1, qualifiedPlayers: 8 })).finalDzpp).toBe(85);
  });

  it('rounds the total half-up, and only the total', () => {
    // 10.5 + 10 = 20.5 exactly, which is the tie the rule has to settle.
    expect(scoreOne(play({ pp: 10.5, qualified: false, placement: null })).finalDzpp).toBe(21);
    // 186.42 + 10 + 25 + 18.75 = 240.17
    const thin = scoreOne(play({ pp: 186.42, placement: 1, qualifiedPlayers: 3 }));
    expect(thin.placementPoints).toBe(18.75);
    expect(thin.finalDzpp).toBe(240);
  });

  // Completion is one award for one play. The schema guarantees one play per person per
  // round, so this is what makes attempts unable to multiply it.
  it('awards completion exactly once however good or bad the play', () => {
    expect(scoreOne(play({ pp: 0, qualified: false })).completionPoints).toBe(COMPLETION_POINTS);
    expect(scoreOne(play({ pp: 9999 })).completionPoints).toBe(COMPLETION_POINTS);
  });
});

// ── scoreRound ───────────────────────────────────────────────────────────────
//
// THE PLAYS ARRIVE ALREADY IN LEADERBOARD ORDER. listForRound in repo/challengeScores.ts
// orders them 'qualified DESC, <orderFor(requirement)>, submitted_at ASC', and that is the
// only implementation of the round's ordering in the codebase. scoreRound numbers what it
// is given rather than sorting again, so there is nothing here that can drift from the
// leaderboard the players were shown.

describe('scoreRound', () => {
  const q = (userId: number, pp: number | null): DzppRoundPlay => ({ userId, pp, qualified: true });
  const nq = (userId: number, pp: number | null): DzppRoundPlay => ({ userId, pp, qualified: false });
  const dzpp = (rows: ReturnType<typeof scoreRound>) => rows.map((row) => row.finalDzpp);

  it('scores an empty round as nothing at all', () => {
    expect(scoreRound([])).toEqual([]);
  });

  it('numbers the qualified plays from first in the order it was given', () => {
    const rows = scoreRound([q(1, 100), q(2, 90), q(3, 80)]);
    expect(rows.map((row) => row.placement)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.userId)).toEqual([1, 2, 3]);
  });

  it('counts the qualified field, not the number of plays', () => {
    const rows = scoreRound([q(1, 100), q(2, 90), nq(3, 300), nq(4, 250)]);
    expect(rows.every((row) => row.fieldSize === 2)).toBe(true);
  });

  // A non-qualifying play must not consume a placement number, or every player behind it
  // would be demoted for somebody else's failed attempt.
  it('does not let a non-qualifying play consume a placement', () => {
    const rows = scoreRound([q(1, 100), nq(2, 300), q(3, 90)]);
    expect(rows.map((row) => row.placement)).toEqual([1, null, 2]);
  });

  it('scores a round where nobody qualified as completion alone', () => {
    const rows = scoreRound([nq(1, 200), nq(2, 150)]);
    expect(dzpp(rows)).toEqual([210, 160]);
    expect(rows.every((row) => row.fieldSize === 0)).toBe(true);
    expect(rows.every((row) => row.placementPoints === 0)).toBe(true);
  });

  // Ties are already resolved before this point: listForRound breaks them on the
  // requirement's own key and then on submitted_at ASC, so two plays that look identical
  // here still arrive in a settled order and are numbered sequentially.
  it('numbers plays that look identical sequentially, in the order given', () => {
    const rows = scoreRound([q(7, 150), q(4, 150), q(9, 150)]);
    expect(rows.map((row) => row.placement)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.userId)).toEqual([7, 4, 9]);
  });

  // Specification section 5, round A: 3 qualified on a ranked 5.24 star map, HD required,
  // Lowest Miss Count. Field factor 0.375.
  it('reproduces the worked example for a three-player field', () => {
    const rows = scoreRound([q(1, 186.42), q(2, 171.08), q(3, 142.65), nq(4, 268.75)]);
    expect(rows.map((row) => row.fieldSize)).toEqual([3, 3, 3, 3]);
    expect(rows.map((row) => row.placementPoints)).toEqual([18.75, 15, 11.25, 0]);
    expect(dzpp(rows)).toEqual([240, 221, 189, 279]);
  });

  // Round B: 8 qualified on a ranked 6.13 star map, HDHR required, Full Combo. The field
  // factor is 1, so this is also the test that every configured placement pays its table
  // value.
  it('reproduces the worked example for a field of eight, paying every placement', () => {
    const rows = scoreRound([
      q(1, 331.2), q(2, 318.55), q(3, 310), q(4, 296.1),
      q(5, 288.2), q(6, 281.75), q(7, 276.9), q(8, 271.44),
      nq(9, 289.66),
    ]);
    expect(rows.map((row) => row.placementPoints)).toEqual([50, 40, 30, 25, 20, 15, 10, 5, 0]);
    expect(dzpp(rows)).toEqual([416, 394, 375, 356, 343, 332, 322, 311, 300]);
  });

  // Round C: 20 qualified on a ranked 4.31 star map, NM required, Best Accuracy. Past
  // eighth place the table pays nothing, so everyone from ninth down earns the same
  // 35 points of completion and qualification on top of their own performance.
  const TWENTY_PP = [
    128.94, 124.1, 121.66, 119.03, 117.41, 115.88, 114.02, 112.35, 110.8, 108.22,
    106.51, 104.9, 103.12, 101.47, 99.83, 97.2, 95.64, 93.11, 90.78, 88.15,
  ];

  it('reproduces the worked example for a field of twenty', () => {
    const rows = scoreRound([
      ...TWENTY_PP.map((pp, i) => q(i + 1, pp)),
      nq(99, 121.44),
    ]);

    expect(rows.every((row) => row.fieldSize === 20)).toBe(true);
    expect(rows[0].finalDzpp).toBe(214);
    expect(rows[1].finalDzpp).toBe(199);
    expect(rows[7].finalDzpp).toBe(152);
    expect(rows[8].finalDzpp).toBe(146);
    expect(rows[9].finalDzpp).toBe(143);
    expect(rows[19].finalDzpp).toBe(123);
    expect(rows[20].finalDzpp).toBe(131);

    // Ninth place and below earn no placement points at all.
    expect(rows.slice(8, 20).every((row) => row.placementPoints === 0)).toBe(true);
    expect(rows[7].placementPoints).toBe(5);
  });

  // The same twenty-player field on a LOVED map. osu! awards no pp there, so the whole
  // round is scored on completion, qualification and placement alone.
  it('scores the same field on a Loved map from the other three terms alone', () => {
    const rows = scoreRound([
      ...TWENTY_PP.map((_pp, i) => q(i + 1, null)),
      nq(99, null),
    ]);

    expect(rows.every((row) => row.performanceValue === null)).toBe(true);
    expect(rows[0].finalDzpp).toBe(85);
    expect(rows[1].finalDzpp).toBe(75);
    expect(rows[7].finalDzpp).toBe(40);
    expect(rows[8].finalDzpp).toBe(35);
    expect(rows[19].finalDzpp).toBe(35);
    expect(rows[20].finalDzpp).toBe(10);
  });

  // A one-player round is the thinnest field the factor has to cope with: winning it is
  // worth 6.25 placement rather than 50.
  it('pays a lone qualified player an eighth of the winner award', () => {
    const rows = scoreRound([q(1, 200)]);
    expect(rows[0].placementPoints).toBe(6.25);
    expect(rows[0].finalDzpp).toBe(241);
  });
});

// ── The remaining field sizes the roadmap asks for ───────────────────────────
//
// Coverage for the matrix in Phase 2 of the roadmap. The behaviour was already driven out
// by the cycles above; these pin the field sizes it names one by one, so that a change to
// the factor cannot pass unnoticed at any of them.

describe('scoreRound across every field size the roadmap names', () => {
  const q = (userId: number, pp: number | null): DzppRoundPlay => ({ userId, pp, qualified: true });

  it('pays a quarter of the table to a field of two', () => {
    const rows = scoreRound([q(1, 150), q(2, 140)]);
    expect(rows.map((row) => row.placementPoints)).toEqual([12.5, 10]);
    expect(rows.map((row) => row.finalDzpp)).toEqual([198, 185]);
  });

  it('pays half the table to a field of four', () => {
    const rows = scoreRound([q(1, 100), q(2, 100), q(3, 100), q(4, 100)]);
    expect(rows.map((row) => row.placementPoints)).toEqual([25, 20, 15, 12.5]);
    expect(rows.map((row) => row.finalDzpp)).toEqual([160, 155, 150, 148]);
  });

  // The example in the roadmap itself: six qualified players, second place, base 40,
  // factor 0.75, so the actual placement award is 30.
  it('pays three quarters of the table to a field of six', () => {
    const rows = scoreRound([q(1, 0), q(2, 0), q(3, 0), q(4, 0), q(5, 0), q(6, 0)]);
    expect(rows.map((row) => row.placementPoints)).toEqual([37.5, 30, 22.5, 18.75, 15, 11.25]);
    expect(rows[1].placementPoints).toBe(30);
    expect(rows.map((row) => row.finalDzpp)).toEqual([73, 65, 58, 54, 50, 46]);
  });
});

// ── What "no submission" and "rejected" mean here ────────────────────────────
//
// challenge_scores has no review state — submissions.status is the review state of a
// BEATMAP ENTRY in the submission phase, not of a play. A score an administrator rejects is
// overwritten through POST /api/admin/challenge/scores, or its row is simply not there. So
// both of the roadmap's zero rows collapse to the same representable fact: no row.

describe('players with no challenge score', () => {
  it('produces no result for a player who is not in the round', () => {
    const rows = scoreRound([{ userId: 1, pp: 100, qualified: true }]);
    expect(rows).toHaveLength(1);
    expect(rows.map((row) => row.userId)).toEqual([1]);
    // Player 2 played nothing, so there is nothing to freeze and nothing to sum.
    expect(rows.find((row) => row.userId === 2)).toBeUndefined();
  });

  // One play in, one result out. The schema guarantees one play per player per round
  // (challenge_scores_one_per_user_per_round), so this is what makes repeated attempts
  // unable to multiply the completion award.
  it('returns exactly one result per play', () => {
    const rows = scoreRound([
      { userId: 1, pp: 100, qualified: true },
      { userId: 2, pp: 90, qualified: false },
      { userId: 3, pp: 80, qualified: true },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.userId)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.completionPoints)).toEqual([10, 10, 10]);
  });
});

// ── Reading a stored challenge score ─────────────────────────────────────────
//
// node-postgres hands back `numeric` as a STRING, to avoid the silent precision loss of a
// JS number. challenge_scores.accuracy is already read that way. So pp arrives as a string
// too and has to be converted explicitly — and a botched conversion would be invisible,
// because NaN reaches usablePerformance and comes out as "osu! reported no pp".

describe('toRoundPlay', () => {
  it('converts the numeric column and keeps the rest of the row', () => {
    expect(toRoundPlay({ user_id: 7, pp: '331.20', qualified: true })).toEqual({
      userId: 7,
      pp: 331.2,
      qualified: true,
    });
  });

  it('keeps a genuine zero-pp play as zero', () => {
    expect(toRoundPlay({ user_id: 1, pp: '0.00', qualified: false }).pp).toBe(0);
  });

  it('reads a null column as an absent performance value', () => {
    expect(toRoundPlay({ user_id: 1, pp: null, qualified: true }).pp).toBeNull();
  });

  // Number('') is 0, which would turn a broken read into a real zero-pp play. Guarded
  // rather than trusted.
  it('reads an empty or unparseable column as absent, never as zero', () => {
    expect(toRoundPlay({ user_id: 1, pp: '', qualified: true }).pp).toBeNull();
    expect(toRoundPlay({ user_id: 1, pp: '   ', qualified: true }).pp).toBeNull();
    expect(toRoundPlay({ user_id: 1, pp: 'not a number', qualified: true }).pp).toBeNull();
  });
});

// ── When a round may be finalized ────────────────────────────────────────────
//
// PURE, and it takes the round rather than reading it, for the same reason refuseSkipVoting
// and checkBeatmapRules do: the rule is testable without a database, and the transaction
// supplies the facts it has just locked.

describe('refuseFinalize', () => {
  it('allows an ended round that has never been scored', () => {
    expect(refuseFinalize({ phase: 'ended', dzpp_finalized_at: null })).toBeNull();
  });

  // Nothing is final until the round is. A challenge still running has a leaderboard that
  // can still move, so freezing it would freeze the wrong answer.
  it('refuses a round that has not ended', () => {
    expect(refuseFinalize({ phase: 'challenge', dzpp_finalized_at: null })).toBe('not-ended');
    expect(refuseFinalize({ phase: 'voting', dzpp_finalized_at: null })).toBe('not-ended');
    expect(refuseFinalize({ phase: 'submission', dzpp_finalized_at: null })).toBe('not-ended');
  });

  // THE IDEMPOTENCY GUARANTEE. This is what stops a second finalization awarding a second
  // set of points, however many times the call is made.
  it('refuses a round that has already been scored', () => {
    expect(refuseFinalize({ phase: 'ended', dzpp_finalized_at: new Date() })).toBe(
      'already-finalized'
    );
  });

  // ORDER MATTERS, the same way it does in refuseSkipVoting: "this round has not ended" is
  // the more fundamental answer, and reporting an unended round as already-scored would send
  // an administrator looking for the wrong problem.
  it('reports an unended round as unended even if the latch is somehow set', () => {
    expect(refuseFinalize({ phase: 'challenge', dzpp_finalized_at: new Date() })).toBe(
      'not-ended'
    );
  });
});

// ── The ranking DTOs ─────────────────────────────────────────────────────────
//
// node-postgres hands back bigint and numeric as STRINGS. These mappers are where that is
// undone, and a botched conversion here would put NaN on the ranking page rather than fail
// loudly — which is why they are tested rather than trusted.

describe('RANKING_COUNTRY', () => {
  // Approved decision 4: the ranking filters on DZ itself rather than following
  // allowed_countries, because the roadmap says no other country should appear in it.
  // Pinned like the point constants so widening it is a deliberate edit.
  it('is Algeria and nothing else', () => {
    expect(RANKING_COUNTRY).toBe('DZ');
  });
});

describe('toApiRankingEntry', () => {
  const row = {
    user_id: 4,
    rank: 1,
    dzpp: 848,
    rounds_played: 3,
    first_places: 2,
    best_placement: 1,
    osu_id: '4823510',
    username: 'Amine',
    avatar_url: 'https://a.ppy.sh/4823510',
    country_code: 'DZ',
  };

  it('maps a row to the DTO the rankings page reads', () => {
    expect(toApiRankingEntry(row)).toEqual({
      rank: 1,
      userId: 4,
      osuId: 4823510,
      username: 'Amine',
      avatarUrl: 'https://a.ppy.sh/4823510',
      country: 'DZ',
      dzpp: 848,
      roundsPlayed: 3,
      firstPlaces: 2,
      bestPlacement: 1,
    });
  });

  // osu_id is bigint, which arrives as a string precisely so it is not silently truncated.
  it('converts the bigint osu! id rather than passing the string through', () => {
    expect(toApiRankingEntry({ ...row, osu_id: '4823510' }).osuId).toBe(4823510);
  });

  it('reads a missing avatar as an empty string, matching every other DTO', () => {
    expect(toApiRankingEntry({ ...row, avatar_url: null }).avatarUrl).toBe('');
  });

  // country_code is char(2) and Postgres blank-pads char, so reads trim — the same way
  // isEligible and toApiUser do.
  it('trims the blank-padded country column', () => {
    expect(toApiRankingEntry({ ...row, country_code: 'DZ ' }).country).toBe('DZ');
  });

  // min(placement) over a player who never qualified is NULL, and that is not a zero.
  it('keeps an absent best placement absent', () => {
    expect(toApiRankingEntry({ ...row, best_placement: null }).bestPlacement).toBeNull();
  });
});

describe('toApiPlayerDzppRound', () => {
  // Round 3 as it actually stands: pp 325.24, one qualified player, first place. The field
  // factor for a field of one is 0.125, so first place is worth 6.25 rather than 50.
  const row = {
    round_id: 3,
    round_number: 1,
    month: 'September',
    year: 2026,
    performance_value: '325.24',
    completion_points: '10.00',
    qualification_points: '25.00',
    placement_points: '6.250',
    placement: 1,
    qualified: true,
    field_size: 1,
    final_dzpp: 366,
  };

  it('converts every numeric column and keeps the round it belongs to', () => {
    expect(toApiPlayerDzppRound(row)).toEqual({
      roundId: 3,
      roundNumber: 1,
      month: 'September',
      year: 2026,
      performanceValue: 325.24,
      completionPoints: 10,
      qualificationPoints: 25,
      placementPoints: 6.25,
      placement: 1,
      qualified: true,
      fieldSize: 1,
      finalDzpp: 366,
    });
  });

  // The roadmap's own verification for Phase 3: the stored total has to equal what the
  // engine answers for the same inputs. If these ever disagree, one of them is lying to
  // the player about why they have the points they have.
  it('agrees with the engine about the total it stored', () => {
    expect(
      scoreOne({ pp: 325.24, qualified: true, placement: 1, qualifiedPlayers: 1 }).finalDzpp
    ).toBe(row.final_dzpp);
  });

  it('keeps an absent performance value absent, not zero', () => {
    expect(toApiPlayerDzppRound({ ...row, performance_value: null }).performanceValue).toBeNull();
  });

  it('keeps a non-qualifying round unplaced', () => {
    const mapped = toApiPlayerDzppRound({
      ...row,
      performance_value: '268.75',
      qualification_points: '0.00',
      placement_points: '0.000',
      placement: null,
      qualified: false,
      final_dzpp: 279,
    });
    expect(mapped.placement).toBeNull();
    expect(mapped.qualified).toBe(false);
    expect(mapped.placementPoints).toBe(0);
    expect(mapped.finalDzpp).toBe(279);
  });
});

// ── When a round may be recomputed ───────────────────────────────────────────
//
// Deliberately a DIFFERENT rule from refuseFinalize, and the difference is the whole point:
// finalization refuses an already-scored round, because scoring it twice would award the points
// twice. A recompute is the sanctioned way to score it again, so the latch must not refuse it —
// and it must also accept a round the latch never stamped at all, which is what makes one action
// cover both a retuned constant and a finalization that never ran.

describe('refuseRecompute', () => {
  it('allows an ended round that has already been scored', () => {
    expect(refuseRecompute({ phase: 'ended', dzpp_finalized_at: new Date() })).toBeNull();
  });

  // The round that ended before the finalization hook existed. One action, both cases.
  it('allows an ended round that was never scored', () => {
    expect(refuseRecompute({ phase: 'ended', dzpp_finalized_at: null })).toBeNull();
  });

  // Nothing is recomputed while it can still change on its own. A challenge still running has a
  // leaderboard that moves, so freezing it early would freeze the wrong answer.
  it('refuses a round that has not ended', () => {
    expect(refuseRecompute({ phase: 'challenge', dzpp_finalized_at: null })).toBe('not-ended');
    expect(refuseRecompute({ phase: 'challenge', dzpp_finalized_at: new Date() })).toBe('not-ended');
    expect(refuseRecompute({ phase: 'voting', dzpp_finalized_at: null })).toBe('not-ended');
    expect(refuseRecompute({ phase: 'submission', dzpp_finalized_at: null })).toBe('not-ended');
  });

  // The two rules disagree on exactly one input, which is the reason both exist.
  it('differs from refuseFinalize only on an already-scored ended round', () => {
    const scored = { phase: 'ended', dzpp_finalized_at: new Date() };
    expect(refuseFinalize(scored)).toBe('already-finalized');
    expect(refuseRecompute(scored)).toBeNull();

    const unscored = { phase: 'ended', dzpp_finalized_at: null };
    expect(refuseFinalize(unscored)).toBeNull();
    expect(refuseRecompute(unscored)).toBeNull();
  });
});
