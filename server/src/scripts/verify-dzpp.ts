// DZPP invariant audit — Phase 8 of the DZPP roadmap.
//
// READ-ONLY BY CONSTRUCTION. Every statement here is a SELECT; the script holds no transaction,
// writes nothing, and is safe to run against a live instance at any time. Its counterparts are
// verify-public.mjs and verify-authenticated.mjs, which check the HTTP contract; this one checks
// that the DATA the frozen pipeline produced actually agrees with the approved formula.
//
//   cd server && pnpm run dzpp:verify
//
// WHY A SCRIPT RATHER THAN TESTS. This repository has no database-backed test suite — approved
// decision 6 — and the invariants worth checking are about real rows: that every ended round was
// scored, that every stored total still equals what repo/dzpp.ts computes for its own inputs,
// that the ranking aggregate reconciles with the rows underneath it, and that no player outside
// the ranking's country reaches it. Those cannot be asserted without a database, and they are
// exactly the things a silent bug would break.
//
// It re-derives from the SAME engine the server uses — scoreRound and toRoundPlay out of
// repo/dzpp.ts — so a drift between the stored rows and the formula shows up as a failure rather
// than as agreement between two copies of the same mistake.

import pg from 'pg';
import { resolveTarget, printTarget } from './guard.js';
import {
  DZPP_FORMULA_VERSION,
  RANKING_COUNTRY,
  scoreRound,
  toRoundPlay,
  type DzppRoundPlay,
} from '../repo/dzpp.js';
import { orderFor } from '../repo/challengeScores.js';

const target = resolveTarget();
printTarget(target);

const pool = new pg.Pool({ connectionString: target.url, connectionTimeoutMillis: 5000 });

let pass = 0;
let fail = 0;
const notes: string[] = [];

function ok(what: string, condition: boolean, detail = ''): void {
  if (condition) {
    pass += 1;
    console.log(`  ok    ${what}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Something true but worth a human eye, rather than a pass or a failure. */
function note(text: string): void {
  notes.push(text);
}

interface RoundRow {
  id: number;
  round_number: number;
  phase: string;
  year: number;
  dzpp_finalized_at: Date | null;
  winning_submission_id: number | null;
}

interface FrozenRow {
  round_id: number;
  user_id: number;
  performance_value: string | null;
  completion_points: string;
  qualification_points: string;
  placement_points: string;
  placement: number | null;
  qualified: boolean;
  field_size: number;
  final_dzpp: number;
  formula_version: number;
}

try {
  console.log('--- rounds: every ended round is either scored or visibly not ---');

  const { rows: rounds } = await pool.query<RoundRow>(
    `SELECT id, round_number, phase, year, dzpp_finalized_at, winning_submission_id
       FROM rounds ORDER BY round_number`
  );
  const ended = rounds.filter((r) => r.phase === 'ended');
  const open = rounds.filter((r) => r.phase !== 'ended');

  ok('at most one round is open at a time', open.length <= 1, `${open.length} open`);

  // An OPEN round must never hold frozen DZPP: nothing is final until the round is.
  const { rows: earlyFreeze } = await pool.query<{ round_id: number }>(
    `SELECT DISTINCT d.round_id FROM round_dzpp d
       JOIN rounds r ON r.id = d.round_id WHERE r.phase <> 'ended'`
  );
  ok(
    'no round that is still open holds frozen DZPP',
    earlyFreeze.length === 0,
    `rounds ${earlyFreeze.map((r) => r.round_id).join(', ')}`
  );

  // The repair case. An ended round with scores and no latch was never finalized — which is
  // recoverable through the Phase 7 recompute, and is a finding rather than a corruption.
  for (const round of ended) {
    const { rows: counts } = await pool.query<{ scores: number; frozen: number }>(
      `SELECT (SELECT count(*)::int FROM challenge_scores WHERE round_id = $1) AS scores,
              (SELECT count(*)::int FROM round_dzpp      WHERE round_id = $1) AS frozen`,
      [round.id]
    );
    const { scores, frozen } = counts[0];

    if (round.dzpp_finalized_at === null) {
      if (scores > 0) {
        note(
          `round ${round.round_number} (id ${round.id}) ended with ${scores} score(s) and was never ` +
          `finalized — recoverable with POST /api/admin/dzpp/recompute`
        );
      }
      ok(
        `round ${round.round_number}: an unfinalized round holds no frozen rows`,
        frozen === 0,
        `${frozen} rows with no latch`
      );
    } else {
      // One frozen row per challenge score, no more and no fewer. A player with no score gets
      // no row, which is the whole representation of not taking part.
      ok(
        `round ${round.round_number}: one frozen row per challenge score (${scores})`,
        frozen === scores,
        `${scores} scores but ${frozen} frozen rows`
      );
    }
  }

  console.log('');
  console.log('--- rows: every frozen total still equals what the engine computes ---');

  const finalized = ended.filter((r) => r.dzpp_finalized_at !== null);
  let rowsChecked = 0;

  for (const round of finalized) {
    const { rows: frozen } = await pool.query<FrozenRow>(
      `SELECT round_id, user_id, performance_value, completion_points, qualification_points,
              placement_points, placement, qualified, field_size, final_dzpp, formula_version
         FROM round_dzpp WHERE round_id = $1`,
      [round.id]
    );
    if (frozen.length === 0) continue;

    // The requirement decides the ordering, which decides the placements. Read from the round's
    // own recorded winner, exactly as finalization did.
    let requirement = '';
    if (round.winning_submission_id !== null) {
      const { rows } = await pool.query<{ challenge_requirement: string }>(
        'SELECT challenge_requirement FROM submissions WHERE id = $1',
        [round.winning_submission_id]
      );
      requirement = rows[0]?.challenge_requirement ?? '';
    }

    // The same SELECT and the same ORDER BY listForRound issues, so the placements re-derived
    // here are the ones the leaderboard showed.
     const { rows: plays } = await pool.query<{
      user_id: number;
      pp: string | null;
      qualified: boolean;
      mods: string;
      score: string;
      accuracy: string;
      misses: number;
    }>(
      `SELECT cs.user_id, cs.pp, cs.qualified,
              cs.mods, cs.score, cs.accuracy, cs.misses
         FROM challenge_scores cs
        WHERE cs.round_id = $1
        ORDER BY cs.qualified DESC, ${orderFor(requirement)}, cs.submitted_at ASC`,
      [round.id]
    );
    const expected = new Map(
      scoreRound(plays.map((row) => toRoundPlay(row, false, false, '', requirement))).map((r) => [r.userId, r])
    );

    for (const row of frozen) {
      rowsChecked += 1;
      const want = expected.get(row.user_id);
      const label = `round ${round.round_number} user ${row.user_id}`;

      if (!want) {
        ok(`${label}: has a challenge score behind its frozen row`, false, 'no score found');
        continue;
      }

      const stored = {
        performance: row.performance_value === null ? null : Number(row.performance_value),
        completion: Number(row.completion_points),
        qualification: Number(row.qualification_points),
        placement: Number(row.placement_points),
      };

      ok(`${label}: final_dzpp matches the engine`, row.final_dzpp === want.finalDzpp,
        `stored ${row.final_dzpp}, engine ${want.finalDzpp}`);
      ok(`${label}: every term matches the engine`,
        stored.performance === want.performanceValue &&
        stored.completion === want.completionPoints &&
        stored.qualification === want.qualificationPoints &&
        stored.placement === want.placementPoints &&
        row.placement === want.placement &&
        row.qualified === want.qualified &&
        row.field_size === want.fieldSize,
        `stored ${JSON.stringify({ ...stored, place: row.placement, field: row.field_size })}`);

      // The sum has to be reproducible from the row's own parts, not only from the engine — a
      // row whose terms do not add to its total cannot explain itself to a player.
      const reproduced = Math.round(
        (stored.performance ?? 0) + stored.completion + stored.qualification + stored.placement
      );
      ok(`${label}: the stored terms add up to the stored total`, reproduced === row.final_dzpp,
        `terms give ${reproduced}, total says ${row.final_dzpp}`);

      ok(`${label}: only a qualified play is placed`,
        row.qualified ? row.placement !== null : row.placement === null && stored.placement === 0);
      ok(`${label}: formula version is known`, row.formula_version === DZPP_FORMULA_VERSION,
        `row says v${row.formula_version}, code is v${DZPP_FORMULA_VERSION}`);
    }

    // Placements within a round must be 1..N over the qualified rows, with no gap and no repeat.
    const places = frozen.filter((r) => r.qualified).map((r) => r.placement).sort((a, b) => (a ?? 0) - (b ?? 0));
    const qualifiedCount = places.length;
    ok(`round ${round.round_number}: placements run 1..${qualifiedCount} exactly once`,
      places.every((p, i) => p === i + 1),
      `saw ${places.join(', ')}`);
    ok(`round ${round.round_number}: field_size equals the qualified count on every row`,
      frozen.every((r) => r.field_size === qualifiedCount),
      `qualified ${qualifiedCount}`);
  }

  note(`${rowsChecked} frozen row(s) re-derived against the engine across ${finalized.length} finalized round(s)`);

  console.log('');
  console.log('--- pp: the frozen performance value is the one the play carried ---');

  const { rows: ppDrift } = await pool.query<{ round_id: number; user_id: number; frozen: string | null; live: string | null }>(
    `SELECT d.round_id, d.user_id, d.performance_value AS frozen, cs.pp AS live
       FROM round_dzpp d
       JOIN challenge_scores cs ON cs.round_id = d.round_id AND cs.user_id = d.user_id
      WHERE COALESCE(d.performance_value, -1) <> COALESCE(cs.pp, -1)`
  );
  // Drift is legal and not a bug: re-importing a play after a round closed would move
  // challenge_scores.pp while the frozen row stays put, which is the freeze working. It is worth
  // naming though, because it means a recompute would change that round's total.
  if (ppDrift.length > 0) {
    for (const row of ppDrift) {
      note(
        `round ${row.round_id} user ${row.user_id}: frozen pp ${row.frozen ?? 'NULL'} but the stored ` +
        `play now says ${row.live ?? 'NULL'} — a recompute would move this round`
      );
    }
  }
  ok('no frozen row references a play that no longer exists',
    (await pool.query(
      `SELECT 1 FROM round_dzpp d
        WHERE NOT EXISTS (SELECT 1 FROM challenge_scores cs
                           WHERE cs.round_id = d.round_id AND cs.user_id = d.user_id)`
    )).rows.length === 0);

  console.log('');
  console.log('--- ranking: the aggregate reconciles with the rows underneath it ---');

  // The country rule, asserted against the data rather than trusted from the query. Every user
  // with a frozen row that is NOT in the ranking country must be absent from the ranking, and
  // every user in it must be present.
  const { rows: everyone } = await pool.query<{ user_id: number; country: string; total: number; rounds: number }>(
    `SELECT d.user_id, upper(trim(u.country_code)) AS country,
            SUM(d.final_dzpp)::int AS total, count(*)::int AS rounds
       FROM round_dzpp d JOIN users u ON u.id = d.user_id
      GROUP BY d.user_id, upper(trim(u.country_code))`
  );

  const { rows: ranked } = await pool.query<{ user_id: number; dzpp: number; rounds_played: number; first_places: number; best_placement: number | null }>(
    `WITH totals AS (
       SELECT d.user_id, SUM(d.final_dzpp)::int AS dzpp, count(*)::int AS rounds_played,
              count(*) FILTER (WHERE d.placement = 1)::int AS first_places,
              min(d.placement) AS best_placement
         FROM round_dzpp d
         JOIN rounds r ON r.id = d.round_id
         JOIN users  u ON u.id = d.user_id
        WHERE upper(trim(u.country_code)) = $1
        GROUP BY d.user_id
     )
     SELECT * FROM totals`,
    [RANKING_COUNTRY]
  );

  const rankedIds = new Set(ranked.map((r) => r.user_id));
  const inCountry = everyone.filter((r) => r.country === RANKING_COUNTRY);
  const outside = everyone.filter((r) => r.country !== RANKING_COUNTRY);

  ok(`every ${RANKING_COUNTRY} player with frozen DZPP appears in the ranking`,
    inCountry.every((r) => rankedIds.has(r.user_id)),
    `${inCountry.length} in country, ${rankedIds.size} ranked`);
  ok('no player outside the ranking country appears in it',
    outside.every((r) => !rankedIds.has(r.user_id)),
    `${outside.length} outside: ${outside.map((r) => `${r.user_id}/${r.country}`).join(', ')}`);
  if (outside.length === 0) {
    note(`no non-${RANKING_COUNTRY} player holds frozen DZPP, so the exclusion half of the country rule rests on the fixture checks below rather than on live rows`);
  }

  for (const row of ranked) {
    const truth = everyone.find((r) => r.user_id === row.user_id);
    ok(`user ${row.user_id}: ranking total equals the sum of their frozen rows`,
      truth !== undefined && row.dzpp === truth.total,
      `ranking ${row.dzpp}, rows ${truth?.total}`);
    ok(`user ${row.user_id}: rounds played equals their frozen row count`,
      truth !== undefined && row.rounds_played === truth.rounds,
      `ranking ${row.rounds_played}, rows ${truth?.rounds}`);
  }

  // Seasons have to partition the all-time total exactly: every frozen round belongs to one
  // calendar year, so the year tables must sum back to the all-time one per player.
  const { rows: byYear } = await pool.query<{ user_id: number; year: number; total: number }>(
    `SELECT d.user_id, r.year, SUM(d.final_dzpp)::int AS total
       FROM round_dzpp d
       JOIN rounds r ON r.id = d.round_id
       JOIN users  u ON u.id = d.user_id
      WHERE upper(trim(u.country_code)) = $1
      GROUP BY d.user_id, r.year`,
    [RANKING_COUNTRY]
  );

  for (const row of ranked) {
    const summed = byYear.filter((y) => y.user_id === row.user_id).reduce((sum, y) => sum + y.total, 0);
    ok(`user ${row.user_id}: the year tables sum to their all-time total`,
      summed === row.dzpp, `years give ${summed}, all-time says ${row.dzpp}`);
  }

  const years = [...new Set(byYear.map((y) => y.year))];
  if (years.length < 2) {
    note(`only ${years.length} season(s) hold DZPP (${years.join(', ') || 'none'}), so multi-year separation rests on the fixture checks below rather than on live rows`);
  }

  console.log('');
  console.log('--- predicates: the rules real data cannot reach yet, against a fixture ---');
  //
  // The four notes above name what the live rows cannot exercise: a player outside the ranking
  // country, more than one season, and a tie on total DZPP. Those are SQL PREDICATES rather than
  // formula rules, so the Phase 2 unit tests cannot reach them either — the engine never sees a
  // country or a year.
  //
  // So they are exercised here against a LITERAL SET held in a CTE. Nothing is written and no
  // table is read: this asserts that the country filter, the season filter and RANK() behave as
  // the ranking query depends on, without putting synthetic rows in the database, which roadmap
  // rule 12 forbids.

  const FIXTURE = `fixture(user_id, country, year, dzpp) AS (VALUES
      (1, 'DZ', 2026, 300), (1, 'DZ', 2025, 252),
      (2, 'DZ', 2026, 400),
      (3, 'DZ', 2025, 552),
      (4, 'MA', 2026, 900),
      (5, 'dz', 2026, 100))`;

  const rank = async (year: number | null) => {
    const { rows } = await pool.query<{ user_id: number; dzpp: number; rank: number }>(
      `WITH ${FIXTURE}, totals AS (
         SELECT user_id, SUM(dzpp)::int AS dzpp FROM fixture
          WHERE upper(trim(country)) = $1 AND ($2::int IS NULL OR year = $2)
          GROUP BY user_id
       )
       SELECT user_id, dzpp, RANK() OVER (ORDER BY dzpp DESC)::int AS rank
         FROM totals ORDER BY dzpp DESC, user_id ASC`,
      [RANKING_COUNTRY, year]
    );
    return rows;
  };

  const allTime = await rank(null);
  ok('the country filter excludes a player from another country',
    !allTime.some((r) => r.user_id === 4), `saw ${allTime.map((r) => r.user_id).join(', ')}`);
  ok('the country filter is case- and padding-insensitive, matching isEligible',
    allTime.some((r) => r.user_id === 5), 'lowercase dz was excluded');
  ok('all-time sums a player across seasons',
    allTime.find((r) => r.user_id === 1)?.dzpp === 552, JSON.stringify(allTime));
  ok('players level on total DZPP share a rank, and the next distinct total skips',
    allTime.filter((r) => r.dzpp === 552).every((r) => r.rank === 1) &&
      allTime.find((r) => r.dzpp === 400)?.rank === 3,
    JSON.stringify(allTime));

  const y2025 = await rank(2025);
  const y2026 = await rank(2026);
  ok('a season table holds only that season',
    y2025.length === 2 && y2025.find((r) => r.user_id === 3)?.dzpp === 552 &&
      y2025.find((r) => r.user_id === 1)?.dzpp === 252,
    JSON.stringify(y2025));
  ok('seasons partition the all-time total for a player who played in both',
    (y2025.find((r) => r.user_id === 1)?.dzpp ?? 0) + (y2026.find((r) => r.user_id === 1)?.dzpp ?? 0) === 552);
  ok('a season with no rows is an empty table rather than an error',
    (await rank(1999)).length === 0);

  console.log('');
  console.log('--- audit: every recompute left a record ---');

  const { rows: recomputes } = await pool.query<{
    round_id: number; round_number: number; previous_total: number; new_total: number; reason: string; recomputed_at: Date;
  }>(
    `SELECT c.round_id, r.round_number, c.previous_total, c.new_total, c.reason, c.recomputed_at
       FROM dzpp_recomputes c JOIN rounds r ON r.id = c.round_id
      ORDER BY c.recomputed_at`
  );

  ok('every recompute row names a reason', recomputes.every((r) => r.reason.trim().length >= 10),
    `${recomputes.filter((r) => r.reason.trim().length < 10).length} without one`);
  ok('every recompute row points at a round that still exists',
    (await pool.query(
      'SELECT 1 FROM dzpp_recomputes c WHERE NOT EXISTS (SELECT 1 FROM rounds r WHERE r.id = c.round_id)'
    )).rows.length === 0);
  note(`${recomputes.length} recompute(s) recorded${recomputes.length ? ': ' + recomputes.map((r) => `round ${r.round_number} ${r.previous_total}→${r.new_total}`).join(', ') : ''}`);

  console.log('');
  console.log(`${pass} passed, ${fail} failed`);
  if (notes.length > 0) {
    console.log('');
    console.log('Worth a human eye:');
    for (const line of notes) console.log(`  · ${line}`);
  }
  process.exitCode = fail === 0 ? 0 : 1;
} catch (err) {
  console.error('FAIL  the audit could not complete.');
  console.error(`      ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 4;
} finally {
  await pool.end();
}
