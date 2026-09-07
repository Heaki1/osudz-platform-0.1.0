import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_SCORE_POINTS,
  DZPP_FORMULA_VERSION,
  FIELD_FACTOR_TARGET,
  PLACEMENT_TABLE,
  QUALIFICATION_POINTS,
  RANKING_COUNTRY,
  SUBMISSION_APPROVED_POINTS,
  VOTE_POINTS,
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
  it('holds the values approved for formula version 2', () => {
    expect(CHALLENGE_SCORE_POINTS).toBe(2);
    expect(SUBMISSION_APPROVED_POINTS).toBe(3);
    expect(VOTE_POINTS).toBe(5);
    expect(QUALIFICATION_POINTS).toBe(25);
    expect(FIELD_FACTOR_TARGET).toBe(8);
    expect(DZPP_FORMULA_VERSION).toBe(2);
    expect([...PLACEMENT_TABLE]).toEqual([50, 40, 30, 25, 20, 15, 10, 5]);
  });

  it('sums to the old flat completion maximum of 10', () => {
    expect(CHALLENGE_SCORE_POINTS + SUBMISSION_APPROVED_POINTS + VOTE_POINTS).toBe(10);
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
// with no challenge_scores row has no breakdown and no frozen row at all.
//
// Completion is now three sub-awards:
//   CHALLENGE_SCORE_POINTS (2)       — always, for having a score row
//   SUBMISSION_APPROVED_POINTS (3)   — if hadApprovedSubmission
//   VOTE_POINTS (5)                  — if hadVote
//
// The play() helper defaults both flags to false so existing arithmetic tests stay
// readable. Tests that exercise the sub-awards set them explicitly.

describe('scoreOne', () => {
  const play = (over: Partial<DzppScoreInput> = {}): DzppScoreInput => ({
    pp: 100,
    qualified: true,
    placement: 1,
    qualifiedPlayers: 8,
    hadApprovedSubmission: false,
    hadVote: false,
    ...over,
  });

  // ── Completion sub-awards ────────────────────────────────────────────────

  it('awards only CHALLENGE_SCORE_POINTS when neither flag is set', () => {
    const result = scoreOne(play({ pp: null, qualified: false, placement: null }));
    expect(result.completionPoints).toBe(CHALLENGE_SCORE_POINTS); // 2
  });

  it('adds SUBMISSION_APPROVED_POINTS when hadApprovedSubmission is true', () => {
    const result = scoreOne(play({ pp: null, qualified: false, placement: null, hadApprovedSubmission: true }));
    expect(result.completionPoints).toBe(CHALLENGE_SCORE_POINTS + SUBMISSION_APPROVED_POINTS); // 5
  });

  it('adds VOTE_POINTS when hadVote is true', () => {
    const result = scoreOne(play({ pp: null, qualified: false, placement: null, hadVote: true }));
    expect(result.completionPoints).toBe(CHALLENGE_SCORE_POINTS + VOTE_POINTS); // 7
  });

  it('awards the full 10 when both flags are set', () => {
    const result = scoreOne(play({ pp: null, qualified: false, placement: null, hadApprovedSubmission: true, hadVote: true }));
    expect(result.completionPoints).toBe(CHALLENGE_SCORE_POINTS + SUBMISSION_APPROVED_POINTS + VOTE_POINTS); // 10
  });

  // ── Full formula ─────────────────────────────────────────────────────────

  it('sums performance, completion, qualification and placement (no sub-awards)', () => {
    // completion = 2, qualification = 25, placement = 50, performance = 331.2 => 408
    const result = scoreOne(play({ pp: 331.2, placement: 1, qualifiedPlayers: 8 }));
    expect(result.performanceValue).toBe(331.2);
    expect(result.completionPoints).toBe(2);
    expect(result.qualificationPoints).toBe(25);
    expect(result.placementPoints).toBe(50);
    expect(result.finalDzpp).toBe(408);
  });

  it('sums correctly with all sub-awards active', () => {
    // completion = 10, qualification = 25, placement = 50, performance = 331.2 => 416
    const result = scoreOne(play({ pp: 331.2, placement: 1, qualifiedPlayers: 8, hadApprovedSubmission: true, hadVote: true }));
    expect(result.completionPoints).toBe(10);
    expect(result.finalDzpp).toBe(416);
  });

  it('reports the field size and the formula version it scored under', () => {
    const result = scoreOne(play({ qualifiedPlayers: 3 }));
    expect(result.fieldSize).toBe(3);
    expect(result.formulaVersion).toBe(DZPP_FORMULA_VERSION);
  });

  // A non-qualifying play still earns the challenge-score sub-award: turning up and
  // failing the terms is worth more than not turning up, and less than doing it properly.
  it('pays a non-qualifying play its completion award and nothing else', () => {
    // completion = 2 (no sub-awards), performance = 268.75 => finalDzpp = 271
    const result = scoreOne(play({ pp: 268.75, qualified: false, placement: null }));
    expect(result.qualificationPoints).toBe(0);
    expect(result.placementPoints).toBe(0);
    expect(result.placement).toBeNull();
    expect(result.completionPoints).toBe(2);
    expect(result.finalDzpp).toBe(271);
  });

  // Only qualified players receive placement points. A placement handed in alongside
  // qualified: false is a caller bug, and it must not become points.
  it('refuses placement points to a play that did not qualify', () => {
    const result = scoreOne(play({ qualified: false, placement: 1 }));
    expect(result.placementPoints).toBe(0);
    expect(result.placement).toBeNull();
  });

  it('pays no placement points when there is no placement', () => {
    // completion = 2, qualification = 25, performance = 100 => 127
    const result = scoreOne(play({ placement: null }));
    expect(result.placementPoints).toBe(0);
    expect(result.finalDzpp).toBe(127);
  });

  // The Loved-map case. osu! awards no pp on a Loved beatmap, so the term is absent
  // rather than zero — and the round is scored on the other three terms alone.
  it('treats an absent performance value as absent, not as zero points earned', () => {
    // completion = 2, qualification = 25, placement = 50 (field 20, factor 1) => 77
    const result = scoreOne(play({ pp: null, placement: 1, qualifiedPlayers: 20 }));
    expect(result.performanceValue).toBeNull();
    expect(result.finalDzpp).toBe(77);
  });

  it('keeps a genuine zero-pp play distinct from an absent one', () => {
    const result = scoreOne(play({ pp: 0, placement: 1, qualifiedPlayers: 20 }));
    expect(result.performanceValue).toBe(0);
    expect(result.finalDzpp).toBe(77);
  });

  // osu! cannot report either of these. Reading them as "no value" keeps a bad number out
  // of numeric(8,2) and out of the total, instead of storing a NaN or subtracting DZPP.
  it('reads an impossible performance value as absent', () => {
    expect(scoreOne(play({ pp: Number.NaN })).performanceValue).toBeNull();
    expect(scoreOne(play({ pp: Number.POSITIVE_INFINITY })).performanceValue).toBeNull();
    expect(scoreOne(play({ pp: -5 })).performanceValue).toBeNull();
    // completion=2, qualification=25, placement=50 => 77
    expect(scoreOne(play({ pp: -5, placement: 1, qualifiedPlayers: 8 })).finalDzpp).toBe(77);
  });

  it('rounds the total half-up, and only the total', () => {
    // 10.5 + 2 = 12.5 exactly — rounds up to 13
    expect(scoreOne(play({ pp: 10.5, qualified: false, placement: null })).finalDzpp).toBe(13);
    // 186.42 + 2 + 25 + 18.75 = 232.17 — rounds to 232
    const thin = scoreOne(play({ pp: 186.42, placement: 1, qualifiedPlayers: 3 }));
    expect(thin.placementPoints).toBe(18.75);
    expect(thin.finalDzpp).toBe(232);
  });

  // CHALLENGE_SCORE_POINTS is one award for one play. The schema guarantees one play per
  // person per round, so this is what makes attempts unable to multiply it.
  it('awards CHALLENGE_SCORE_POINTS exactly once however good or bad the play', () => {
    expect(scoreOne(play({ pp: 0, qualified: false })).completionPoints).toBe(CHALLENGE_SCORE_POINTS);
    // With both sub-awards the total is 10, not more.
    expect(scoreOne(play({ pp: 9999, hadApprovedSubmission: true, hadVote: true })).completionPoints).toBe(10);
  });
});

// ── scoreRound ───────────────────────────────────────────────────────────────
//
// THE PLAYS ARRIVE ALREADY IN LEADERBOARD ORDER. listForRound in repo/challengeScores.ts
// orders them 'qualified DESC, <orderFor(requirement)>, submitted_at ASC', and that is the
// only implementation of the round's ordering in the codebase. scoreRound numbers what it
// is given rather than sorting again, so there is nothing here that can drift from the
// leaderboard the players were shown.
//
// The q/nq helpers default hadApprovedSubmission and hadVote to false so the arithmetic
// in the worked examples stays clean. Tests that need the sub-awards set them explicitly.

describe('scoreRound', () => {
  const q = (userId: number, pp: number | null): DzppRoundPlay => ({
    userId, pp, qualified: true, hadApprovedSubmission: false, hadVote: false,
  });
  const nq = (userId: number, pp: number | null): DzppRoundPlay => ({
    userId, pp, qualified: false, hadApprovedSubmission: false, hadVote: false,
  });
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
    // completion = 2 each; nq(1,200) => 202, nq(2,150) => 152
    const rows = scoreRound([nq(1, 200), nq(2, 150)]);
    expect(dzpp(rows)).toEqual([202, 152]);
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
  // Lowest Miss Count. Field factor 0.375. No sub-awards (defaults).
  // completion=2, qualification=25, placement varies, performance varies.
  it('reproduces the worked example for a three-player field', () => {
    const rows = scoreRound([q(1, 186.42), q(2, 171.08), q(3, 142.65), nq(4, 268.75)]);
    expect(rows.map((row) => row.fieldSize)).toEqual([3, 3, 3, 3]);
    expect(rows.map((row) => row.placementPoints)).toEqual([18.75, 15, 11.25, 0]);
    // 186.42+2+25+18.75=232.17=>232, 171.08+2+25+15=213.08=>213,
    // 142.65+2+25+11.25=180.9=>181, 268.75+2+0+0=270.75=>271
    expect(dzpp(rows)).toEqual([232, 213, 181, 271]);
  });

  // Round B: 8 qualified on a ranked 6.13 star map, HDHR required, Full Combo. The field
  // factor is 1, so this is also the test that every configured placement pays its table
  // value. No sub-awards.
  it('reproduces the worked example for a field of eight, paying every placement', () => {
    const rows = scoreRound([
      q(1, 331.2), q(2, 318.55), q(3, 310), q(4, 296.1),
      q(5, 288.2), q(6, 281.75), q(7, 276.9), q(8, 271.44),
      nq(9, 289.66),
    ]);
    expect(rows.map((row) => row.placementPoints)).toEqual([50, 40, 30, 25, 20, 15, 10, 5, 0]);
    // Each: pp + 2 (completion) + 25 (qual) + placement
    // 331.2+2+25+50=408, 318.55+2+25+40=386 (385.55=>386), 310+2+25+30=367,
    // 296.1+2+25+25=348, 288.2+2+25+20=335, 281.75+2+25+15=324 (323.75=>324),
    // 276.9+2+25+10=314 (313.9=>314), 271.44+2+25+5=303, 289.66+2+0+0=292 (291.66=>292)
    expect(dzpp(rows)).toEqual([408, 386, 367, 348, 335, 324, 314, 303, 292]);
  });

  // Round C: 20 qualified on a ranked 4.31 star map, NM required, Best Accuracy. Past
  // eighth place the table pays nothing, so everyone from ninth down earns the same
  // 27 points of completion and qualification on top of their own performance.
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
    // 128.94+2+25+50=205.94=>206
    expect(rows[0].finalDzpp).toBe(206);
    // 124.1+2+25+40=191.1=>191
    expect(rows[1].finalDzpp).toBe(191);
    // 112.35+2+25+5=144.35=>144
    expect(rows[7].finalDzpp).toBe(144);
    // 110.8+2+25+0=137.8=>138
    expect(rows[8].finalDzpp).toBe(138);
    // 108.22+2+25+0=135.22=>135
    expect(rows[9].finalDzpp).toBe(135);
    // 88.15+2+25+0=115.15=>115
    expect(rows[19].finalDzpp).toBe(115);
    // nq: 121.44+2+0+0=123.44=>123
    expect(rows[20].finalDzpp).toBe(123);

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
    // 0+2+25+50=77
    expect(rows[0].finalDzpp).toBe(77);
    // 0+2+25+40=67
    expect(rows[1].finalDzpp).toBe(67);
    // 0+2+25+5=32
    expect(rows[7].finalDzpp).toBe(32);
    // 0+2+25+0=27
    expect(rows[8].finalDzpp).toBe(27);
    expect(rows[19].finalDzpp).toBe(27);
    // nq: 0+2+0+0=2
    expect(rows[20].finalDzpp).toBe(2);
  });

  // A one-player round is the thinnest field the factor has to cope with: winning it is
  // worth 6.25 placement rather than 50.
  it('pays a lone qualified player an eighth of the winner award', () => {
    const rows = scoreRound([q(1, 200)]);
    expect(rows[0].placementPoints).toBe(6.25);
    // 200+2+25+6.25=233.25=>233
    expect(rows[0].finalDzpp).toBe(233);
  });

  it('passes sub-award flags through to each play', () => {
    const withBoth: DzppRoundPlay = { userId: 1, pp: 100, qualified: true, hadApprovedSubmission: true, hadVote: true };
    const withNone: DzppRoundPlay = { userId: 2, pp: 100, qualified: true, hadApprovedSubmission: false, hadVote: false };
    const rows = scoreRound([withBoth, withNone]);
    expect(rows[0].completionPoints).toBe(10);
    expect(rows[1].completionPoints).toBe(2);
  });
});

// ── The remaining field sizes the roadmap asks for ───────────────────────────
//
// Coverage for the matrix in Phase 2 of the roadmap. The behaviour was already driven out
// by the cycles above; these pin the field sizes it names one by one, so that a change to
// the factor cannot pass unnoticed at any of them.

describe('scoreRound across every field size the roadmap names', () => {
  const q = (userId: number, pp: number | null): DzppRoundPlay => ({
    userId, pp, qualified: true, hadApprovedSubmission: false, hadVote: false,
  });

  it('pays a quarter of the table to a field of two', () => {
    const rows = scoreRound([q(1, 150), q(2, 140)]);
    expect(rows.map((row) => row.placementPoints)).toEqual([12.5, 10]);
    // 150+2+25+12.5=189.5=>190, 140+2+25+10=177
    expect(rows.map((row) => row.finalDzpp)).toEqual([190, 177]);
  });

  it('pays half the table to a field of four', () => {
    const rows = scoreRound([q(1, 100), q(2, 100), q(3, 100), q(4, 100)]);
    expect(rows.map((row) => row.placementPoints)).toEqual([25, 20, 15, 12.5]);
    // 100+2+25+placement
    expect(rows.map((row) => row.finalDzpp)).toEqual([152, 147, 142, 140]);
  });

  // The example in the roadmap itself: six qualified players, second place, base 40,
  // factor 0.75, so the actual placement award is 30.
  it('pays three quarters of the table to a field of six', () => {
    const rows = scoreRound([q(1, 0), q(2, 0), q(3, 0), q(4, 0), q(5, 0), q(6, 0)]);
    expect(rows.map((row) => row.placementPoints)).toEqual([37.5, 30, 22.5, 18.75, 15, 11.25]);
    expect(rows[1].placementPoints).toBe(30);
    // 0+2+25+placement
    expect(rows.map((row) => row.finalDzpp)).toEqual([65, 57, 50, 46, 42, 38]);
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
    const rows = scoreRound([{ userId: 1, pp: 100, qualified: true, hadApprovedSubmission: false, hadVote: false }]);
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
      { userId: 1, pp: 100, qualified: true,  hadApprovedSubmission: false, hadVote: false },
      { userId: 2, pp: 90,  qualified: false, hadApprovedSubmission: false, hadVote: false },
      { userId: 3, pp: 80,  qualified: true,  hadApprovedSubmission: false, hadVote: false },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.userId)).toEqual([1, 2, 3]);
    // All three have no sub-awards, so completion = CHALLENGE_SCORE_POINTS = 2.
    expect(rows.map((row) => row.completionPoints)).toEqual([2, 2, 2]);
  });
});

// ── Reading a stored challenge score ─────────────────────────────────────────
//
// node-postgres hands back `numeric` as a STRING, to avoid the silent precision loss of a
// JS number. challenge_scores.accuracy is already read that way. So pp arrives as a string
// too and has to be converted explicitly — and a botched conversion would be invisible,
// because NaN reaches usablePerformance and comes out as "osu! reported no pp".

describe('toRoundPlay', () => {
  it('converts the numeric column and passes through the sub-award flags', () => {
    expect(toRoundPlay({ user_id: 7, pp: '331.20', qualified: true }, true, false)).toEqual({
      userId: 7,
      pp: 331.2,
      qualified: true,
      hadApprovedSubmission: true,
      hadVote: false,
    });
  });

  it('keeps a genuine zero-pp play as zero', () => {
    expect(toRoundPlay({ user_id: 1, pp: '0.00', qualified: false }, false, false).pp).toBe(0);
  });

  it('reads a null column as an absent performance value', () => {
    expect(toRoundPlay({ user_id: 1, pp: null, qualified: true }, false, false).pp).toBeNull();
  });

  // Number('') is 0, which would turn a broken read into a real zero-pp play. Guarded
  // rather than trusted.
  it('reads an empty or unparseable column as absent, never as zero', () => {
    expect(toRoundPlay({ user_id: 1, pp: '', qualified: true }, false, false).pp).toBeNull();
    expect(toRoundPlay({ user_id: 1, pp: '   ', qualified: true }, false, false).pp).toBeNull();
    expect(toRoundPlay({ user_id: 1, pp: 'not a number', qualified: true }, false, false).pp).toBeNull();
  });

  it('carries both sub-award flags correctly', () => {
    const play = toRoundPlay({ user_id: 1, pp: '100', qualified: true }, true, true);
    expect(play.hadApprovedSubmission).toBe(true);
    expect(play.hadVote).toBe(true);
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
  // A stored row from a round scored under formula version 2: full completion (10),
  // one qualified player, first place. The field factor for a field of one is 0.125,
  // so first place is worth 6.25 rather than 50.
  // finalDzpp = round(325.24 + 10 + 25 + 6.25) = round(366.49) = 366.
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
  // Full completion (hadApprovedSubmission + hadVote) = 10.
  it('agrees with the engine about the total it stored', () => {
    expect(
      scoreOne({
        pp: 325.24,
        qualified: true,
        placement: 1,
        qualifiedPlayers: 1,
        hadApprovedSubmission: true,
        hadVote: true,
      }).finalDzpp
    ).toBe(row.final_dzpp);
  });

  it('keeps an absent performance value absent, not zero', () => {
    expect(toApiPlayerDzppRound({ ...row, performance_value: null }).performanceValue).toBeNull();
  });

  it('keeps a non-qualifying round unplaced', () => {
    const mapped = toApiPlayerDzppRound({
      ...row,
      performance_value: '268.75',
      completion_points: '2.00',
      qualification_points: '0.00',
      placement_points: '0.000',
      placement: null,
      qualified: false,
      final_dzpp: 271,
    });
    expect(mapped.placement).toBeNull();
    expect(mapped.qualified).toBe(false);
    expect(mapped.completionPoints).toBe(2);
    expect(mapped.placementPoints).toBe(0);
    expect(mapped.finalDzpp).toBe(271);
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
