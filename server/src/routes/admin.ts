// Admin endpoints.
//
// router.use(requireAdmin) gates every route in this file, including the ones
// still stubbed — an admin route can never be added here and accidentally ship
// open. Admin status comes from ADMIN_OSU_IDS and is re-derived on each login
// (see repo/users.ts), so granting or revoking it is an env change plus a
// re-login, not a manual UPDATE.

import { Router } from 'express';
import type { Response } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { env } from '../env.js';
import {
  approveWinner,
  canTransition,
  correctWinner,
  listCorrections,
  closeVoting,
  create,
  findCurrent,
  isRoundPhase,
  listTiebreakEntries,
  setPhase,
  skipEmptyVoting,
  toApiRound,
} from '../repo/rounds.js';
import {
  freezeEndedRound,
  listRecomputes,
  recomputeRound,
  toApiDzppRecompute,
} from '../repo/dzpp.js';
import {
  findById as findSubmission,
  listForRound,
  review,
  toApiSubmission,
  REVIEW_DECISIONS,
  type ReviewDecision,
} from '../repo/submissions.js';
import {
  findById as findUserById,
  findByOsuId,
  revokeSessions,
  listAllWithOverrides,
  toApiAdminUser,
} from '../repo/users.js';
import {
  listAll as listOverrides,
  remove as removeOverride,
  toApiOverride,
  upsert as upsertOverride,
} from '../repo/participantPermissions.js';
import { enabledSet } from '../repo/allowedCountries.js';
import {
  CONFIGURABLE_STATUSES,
  settings,
  update,
  type SiteSettingsPatch,
} from '../repo/siteSettings.js';
import {
  isCountryCode,
  listAll as listCountries,
  normalise as normaliseCountry,
  remove as removeCountry,
  setEnabled as setCountryEnabled,
  toApiAllowedCountry,
} from '../repo/allowedCountries.js';
import {
  announceBallotClosed,
  announceCorrection,
  announcePhase,
  announceVotingSkipped,
  announceWinner,
  isConfigured,
} from '../services/discord.js';
import { listForRound as listVotes, toApiVoteAudit } from '../repo/votes.js';
import {
  qualifies,
  toApiChallengeScore,
  upsert as upsertScore,
} from '../repo/challengeScores.js';

const router = Router();

router.use(requireAdmin);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Defaults match the day inputs already shown in AdminDashboard's Round Control. */
const DEFAULT_DAYS = { submission: 7, voting: 3, challenge: 21 } as const;

/** The challenge prize when a round is opened without one named. */
const DEFAULT_REWARD = 'One month of osu!supporter';

function fail(res: Response, err: unknown, where: string): void {
  console.error(`[admin] ${where} failed:`, err instanceof Error ? err.message : err);
  res.status(503).json({ error: 'Database unavailable' });
}

/** Returns the day count, or null if the caller sent something unusable. */
function readDays(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : null;
}

// PATCH /api/admin/round/phase — move the open round to another phase.
//
// Body: { phase, endsAt? }. `endsAt` (ISO 8601, or null to clear) rewrites the
// scheduled end of the phase being entered; omit it to keep the schedule set when
// the round was created. Setting phase to 'ended' closes the round — the next one
// is a separate POST /api/admin/rounds.
router.patch('/round/phase', async (req, res) => {
  const { phase, endsAt } = (req.body ?? {}) as { phase?: unknown; endsAt?: unknown };

  if (!isRoundPhase(phase)) {
    res.status(400).json({
      error: "phase must be one of 'submission', 'voting', 'challenge', 'ended'",
    });
    return;
  }

  let ends: Date | null | undefined;
  if (endsAt !== undefined) {
    if (endsAt === null) {
      ends = null;
    } else if (typeof endsAt === 'string' && !Number.isNaN(Date.parse(endsAt))) {
      ends = new Date(endsAt);
    } else {
      res.status(400).json({ error: 'endsAt must be an ISO 8601 timestamp or null' });
      return;
    }
  }

  try {
    const open = await findCurrent();
    if (!open) {
      res.status(409).json({ error: 'No round is open — create one first' });
      return;
    }

    // Forward, or terminal. canTransition explains why in repo/rounds.ts.
    if (!canTransition(open.phase, phase)) {
      res.status(409).json({
        error: `A round cannot move from the ${open.phase} phase to the ${phase} phase`,
      });
      return;
    }

    const updated = await setPhase(open.id, phase, ends);
    if (!updated) {
      res.status(409).json({ error: 'Round no longer exists' });
      return;
    }
    // Ending a round is what freezes its DZPP. Idempotent through the latch in
    // repo/dzpp.ts, so ending a round the clock has just ended writes nothing twice, and
    // non-throwing, so a ranking failure cannot make a phase change that DID happen answer
    // as though it had not.
    if (updated.phase === 'ended') await freezeEndedRound(updated.id);

    // Only when the phase actually moved: this endpoint is also how a deadline gets
    // rewritten, and canTransition allows from === to for exactly that reason.
    if (updated.phase !== open.phase) announcePhase(updated, updated.phase, false);
    res.json({ ok: true, round: toApiRound(updated) });
  } catch (err) {
    fail(res, err, 'phase update');
  }
});

// POST /api/admin/round/close-voting — end the ballot and record the outcome.
//
// The only way voting ends by hand. It does not advance the phase: the round stays
// in 'voting' with a winner pending, or tied, until POST /round/winner approves one.
// Everything is computed and frozen in one transaction — see repo/rounds.ts.
router.post('/round/close-voting', async (req, res) => {
  try {
    const open = await findCurrent();
    if (!open) {
      res.status(409).json({ error: 'No round is open' });
      return;
    }

    const outcome = await closeVoting(open.id);
    if (!outcome.ok) {
      const message =
        outcome.reason === 'not-voting'
          ? `This round is in the ${open.phase} phase, so there is no ballot to close`
          : outcome.reason === 'already-closed'
            ? 'Voting is already closed for this round'
            : 'Nothing was approved for voting, so there is no winner to record';
      res.status(409).json({ error: message });
      return;
    }

    announceBallotClosed(outcome.round, {
      tied: outcome.tied,
      votes: outcome.round.winner_vote_count,
      total: outcome.round.total_votes,
    });
    res.json({ ok: true, round: toApiRound(outcome.round), tied: outcome.tied });
  } catch (err) {
    fail(res, err, 'close voting');
  }
});

// POST /api/admin/round/skip-voting — end a round whose ballot is empty.
//
// The escape from a round that reached voting with nothing approved. closeVoting refuses
// that case ('no-entries') and the clock stops on it, so before this the only ways out were
// the generic phase endpoint — which does not check that the ballot is actually empty — or
// waiting for a deadline that changes nothing when it passes.
//
// THE ROUND ENDS. No winner, no challenge: a month nobody entered has neither, and the two
// alternatives are a fabricated winner and a challenge with no map. repo/rounds.ts
// skipEmptyVoting only ever writes phase = 'ended', so neither is reachable from here.
//
// THE SERVER COUNTS THE ENTRIES ITSELF, inside the transaction that ends the round. That is
// the whole safety property: this cannot be used to throw away a ballot that has entries in
// it, however the request is crafted, and 'has-entries' is a refusal rather than something
// the caller can assert its way past. The route is admin-only like every other route in this
// file — router.use(requireAdmin) at the top — so an ordinary caller gets 401 or 403 before
// any of this runs.
//
// Deliberately takes NO BODY. A confirmation flag would be a courtesy to a mis-click, not a
// control; the guard above is the control, and the confirmation belongs in the UI.
router.post('/round/skip-voting', async (req, res) => {
  try {
    const open = await findCurrent();
    if (!open) {
      res.status(409).json({ error: 'No round is open' });
      return;
    }

    const outcome = await skipEmptyVoting(open.id);
    if (!outcome.ok) {
      const message =
        outcome.reason === 'gone'
          ? 'Round no longer exists'
          : outcome.reason === 'not-voting'
            ? `This round is in the ${open.phase} phase, so there is no voting phase to skip`
            : outcome.reason === 'already-closed'
              ? 'Voting is already closed for this round — approve the winner instead'
              : `This round has ${outcome.approvedEntries} approved ` +
                `${outcome.approvedEntries === 1 ? 'entry' : 'entries'}, so it has a real ` +
                'ballot. Close voting and approve a winner instead of skipping.';
      res.status(409).json({ error: message });
      return;
    }

    console.log(
      `[admin] round ${outcome.round.round_number} closed with an empty ballot by user ${req.user?.id}`
    );
    announceVotingSkipped(outcome.round);
    res.json({ ok: true, round: toApiRound(outcome.round) });
  } catch (err) {
    fail(res, err, 'skip voting');
  }
});

// POST /api/admin/round/winner — approve the winner and start the challenge.
//
// Body: { submissionId? }, required only when the round closed tied. This is the
// only path from voting to challenge; NEXT_PHASES does not offer that transition, so
// PATCH /round/phase cannot be used to skip this step.
router.post('/round/winner', async (req, res) => {
  const { submissionId } = (req.body ?? {}) as { submissionId?: unknown };
  let chosen: number | undefined;
  if (submissionId !== undefined) {
    const id = typeof submissionId === 'number' ? submissionId : Number(submissionId);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'submissionId must be a submission id' });
      return;
    }
    chosen = id;
  }

  try {
    const open = await findCurrent();
    if (!open) {
      res.status(409).json({ error: 'No round is open' });
      return;
    }

    const admin = req.user;
    if (!admin) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const outcome = await approveWinner(open.id, admin.id, chosen);
    if (!outcome.ok) {
      const message =
        outcome.reason === 'not-closed'
          ? 'Close voting first — there is no winner to approve yet'
          : outcome.reason === 'already-official'
            ? 'This round already has an approved winner'
            : outcome.reason === 'needs-selection'
              ? 'This round is tied, so name which submission won'
              : 'That submission is not one of the entries you may choose from';
      res.status(409).json({ error: message });
      return;
    }

    // Named rather than numbered: an announcement that says submission #7 won tells a
    // reader nothing. A winner that has since been deleted announces without a name.
    const entry =
      outcome.round.winning_submission_id === null
        ? null
        : await findSubmission(outcome.round.winning_submission_id);
    announceWinner(outcome.round, entry);

    res.json({ ok: true, round: toApiRound(outcome.round) });
  } catch (err) {
    fail(res, err, 'approve winner');
  }
});

// GET /api/admin/round/tiebreak — the entries a tied round may be resolved to.
router.get('/round/tiebreak', async (_req, res) => {
  try {
    const open = await findCurrent();
    if (!open) {
      res.json([]);
      return;
    }
    res.json(await listTiebreakEntries(open.id));
  } catch (err) {
    fail(res, err, 'tiebreak list');
  }
});

// GET /api/admin/votes?roundId= — who voted for what.
//
// The only endpoint anywhere that pairs a voter with their choice. It is behind
// requireAdmin like everything in this file, and exists for investigating a dispute:
// docs/todo.txt B11 keeps ballot secrecy for everyone else, and no public route gains
// voter identity because of this one.
router.get('/votes', async (req, res) => {
  const raw = req.query.roundId;
  let roundId: number;

  if (raw === undefined) {
    const open = await findCurrent().catch(() => null);
    if (!open) {
      res.json([]);
      return;
    }
    roundId = open.id;
  } else if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    roundId = Number(raw);
  } else {
    res.status(400).json({ error: 'roundId must be a positive integer' });
    return;
  }

  try {
    const rows = await listVotes(roundId);
    res.json(rows.map(toApiVoteAudit));
  } catch (err) {
    fail(res, err, 'vote audit');
  }
});

// POST /api/admin/challenge/scores — record or override a challenge score by hand.
//
// The manual half of the decision that scores are BOTH fetched automatically and
// enterable by an administrator: for a play the osu! API will not give up, or a
// correction. osu_score_id is deliberately left null on this path — the column exists
// to mark API-imported plays, and its UNIQUE constraint is what stops a hand-entered
// score from ever colliding with an imported one.
//
// The player is named by osu! id, which is what an administrator can read off a
// profile. They must have signed in at least once, because challenge_scores.user_id is
// a foreign key to a real account.
router.post('/challenge/scores', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const osuId = Number(body.osuId);
  if (!Number.isInteger(osuId) || osuId <= 0) {
    res.status(400).json({ error: 'osuId must be the player osu! id' });
    return;
  }

  const score = Number(body.score);
  const accuracy = Number(body.accuracy);
  const misses = Number(body.misses);
  if (!Number.isInteger(score) || score < 0) {
    res.status(400).json({ error: 'score must be a non-negative integer' });
    return;
  }
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) {
    res.status(400).json({ error: 'accuracy must be a percentage between 0 and 100' });
    return;
  }
  if (!Number.isInteger(misses) || misses < 0) {
    res.status(400).json({ error: 'misses must be a non-negative integer' });
    return;
  }

  const mods =
    body.mods === undefined || body.mods === null || body.mods === '' ? 'NM' : body.mods;
  if (typeof mods !== 'string' || mods.length > 16) {
    res.status(400).json({ error: 'mods must be joined acronyms, at most 16 characters' });
    return;
  }

  // OPTIONAL, and absent is the sensible default. This path exists for a play the osu! API
  // will not give up, and an administrator reading a score off a screenshot usually cannot
  // know its pp either. Null means "no performance value" to the DZPP formula, which is a
  // different thing from zero pp earned — so guessing a number here would be worse than
  // leaving it out. Rounded to match numeric(8,2), the way accuracy is on the line below.
  let pp: number | null = null;
  if (body.pp !== undefined && body.pp !== null && body.pp !== '') {
    const value = Number(body.pp);
    if (!Number.isFinite(value) || value < 0) {
      res.status(400).json({ error: 'pp must be a non-negative number, or omitted' });
      return;
    }
    pp = Math.round(value * 100) / 100;
  }

  try {
    const open = await findCurrent();
    if (!open) {
      res.status(409).json({ error: 'No round is open' });
      return;
    }
    if (open.winning_submission_id === null) {
      res.status(409).json({ error: 'This round has no recorded winner to judge a score against' });
      return;
    }

    const winner = await findSubmission(open.winning_submission_id);
    if (!winner) {
      res.status(409).json({ error: 'The recorded winning entry no longer exists' });
      return;
    }

    const player = await findByOsuId(osuId);
    if (!player) {
      res.status(404).json({
        error: 'No account with that osu! id has signed in to osu!DZ, so a score cannot be attributed to it',
      });
      return;
    }

    const row = await upsertScore({
      roundId: open.id,
      userId: player.id,
      score,
      accuracy: Math.round(accuracy * 100) / 100,
      misses,
      mods,
      pp,
      qualified: qualifies(
        { mods, misses },
        {
          modRequirement: winner.mod_requirement,
          challengeRequirement: winner.challenge_requirement,
        }
      ),
      osuScoreId: null,
    });

    res.json({ ok: true, score: toApiChallengeScore(row, 0, null) });
  } catch (err) {
    fail(res, err, 'record score');
  }
});

// ── DZPP recompute (Phase 7) ─────────────────────────────────────────────────
//
// THE ONLY SANCTIONED WAY A FROZEN ROUND CHANGES. Freezing is what keeps roadmap rule 7 honest:
// a constant retuned in month five must not silently rewrite months one to four. Its cost is
// that a round sometimes has to be scored again, and this is that — explicit, audited, and
// scoped to one round.
//
// ONE ROUND ID, ALWAYS, AND NO DEFAULT. There is no bulk form and no "all rounds" flag: a single
// call that rewrote every historical round would be one mistake away from reshaping the whole
// leaderboard, and no audit row can undo that. The caller names the round or gets a 400.
//
// A REASON IS REQUIRED, with the same ten-character minimum the result-correction endpoint uses
// (D4). The freeze exists so history does not move quietly, and an unexplained recompute is the
// quiet case wearing a timestamp.
//
// requireAdmin covers this router, so the administrator is the session rather than anything the
// body can assert.

// GET /api/admin/dzpp/recomputes?roundId= — one round's recompute history, newest first.
router.get('/dzpp/recomputes', async (req, res) => {
  const raw = req.query.roundId;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    res.status(400).json({ error: 'roundId must be a positive integer' });
    return;
  }

  try {
    const rows = await listRecomputes(Number(raw));
    res.json(rows.map(toApiDzppRecompute));
  } catch (err) {
    fail(res, err, 'recompute history');
  }
});

// POST /api/admin/dzpp/recompute — rescore ONE ended round. Body: { roundId, reason }.
router.post('/dzpp/recompute', async (req, res) => {
  const { roundId, reason } = (req.body ?? {}) as Record<string, unknown>;

  const id = Number(roundId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'roundId must be a positive integer — a recompute names one round' });
    return;
  }
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    res.status(400).json({
      error: 'A reason of at least 10 characters is required — a recompute has to say why.',
    });
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const outcome = await recomputeRound(id, reason.trim(), req.user.id);
    if (!outcome.ok) {
      const message =
        outcome.reason === 'gone'
          ? 'That round no longer exists'
          : 'DZPP is only recomputed for a round that has ended — an open round can still change on its own';
      res.status(409).json({ error: message });
      return;
    }
    res.json({ ok: true, summary: outcome.summary });
  } catch (err) {
    fail(res, err, 'dzpp recompute');
  }
});

// POST /api/admin/rounds — open the next round, numbered MAX + 1.
//
// Body: all optional — { month, year, reward, submissionDays, votingDays,
// challengeDays }. month/year default to the current UTC month and year. The
// three day counts become absolute end timestamps that cascade: each phase is
// scheduled to start when the previous one closes.
//
// Rejects with 409 while a round is open, because rounds_single_open allows only
// one non-ended row.
router.post('/rounds', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = new Date();

  const month =
    body.month === undefined || body.month === null || body.month === ''
      ? now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
      : body.month;
  if (typeof month !== 'string' || month.trim() === '' || month.length > 32) {
    res.status(400).json({ error: 'month must be a non-empty string of at most 32 characters' });
    return;
  }

  const year =
    body.year === undefined || body.year === null || body.year === ''
      ? now.getUTCFullYear()
      : Number(body.year);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    res.status(400).json({ error: 'year must be an integer between 2020 and 2100' });
    return;
  }

  // The bounty IS the challenge prize, and it has a default rather than being blank:
  // a round with no prize on screen reads as a round with no prize. An administrator
  // can still set anything here when opening the round.
  const reward =
    body.reward === undefined || body.reward === null || body.reward === ''
      ? DEFAULT_REWARD
      : String(body.reward).slice(0, 200);

  const submissionDays = readDays(body.submissionDays, DEFAULT_DAYS.submission);
  const votingDays = readDays(body.votingDays, DEFAULT_DAYS.voting);
  const challengeDays = readDays(body.challengeDays, DEFAULT_DAYS.challenge);
  if (submissionDays === null || votingDays === null || challengeDays === null) {
    res.status(400).json({
      error: 'submissionDays, votingDays and challengeDays must be integers between 1 and 365',
    });
    return;
  }

  const submissionEndsAt = new Date(now.getTime() + submissionDays * DAY_MS);
  const votingEndsAt = new Date(submissionEndsAt.getTime() + votingDays * DAY_MS);
  const challengeEndsAt = new Date(votingEndsAt.getTime() + challengeDays * DAY_MS);

  try {
    if (await findCurrent()) {
      res.status(409).json({ error: 'A round is already open — end it before opening the next' });
      return;
    }

    const row = await create({
      month: month.trim(),
      year,
      reward,
      submissionEndsAt,
      votingEndsAt,
      challengeEndsAt,
    });
    res.status(201).json(toApiRound(row));
  } catch (err) {
    // 23505 = unique_violation. Either rounds_single_open or round_number caught
    // a create that raced another one.
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505') {
      res.status(409).json({ error: 'A round is already open — end it before opening the next' });
      return;
    }
    fail(res, err, 'round create');
  }
});

// GET /api/admin/submissions — every submission in a round, pending included.
// Defaults to the open round; pass ?roundId= to review an earlier one.
router.get('/submissions', async (req, res) => {
  const raw = req.query.roundId;
  if (raw !== undefined && !(typeof raw === 'string' && /^\d+$/.test(raw))) {
    res.status(400).json({ error: 'roundId must be a positive integer' });
    return;
  }

  try {
    let roundId: number;
    if (typeof raw === 'string') {
      roundId = Number(raw);
    } else {
      const open = await findCurrent();
      if (!open) {
        res.json([]);
        return;
      }
      roundId = open.id;
    }

    const rows = await listForRound(roundId);
    res.json(rows.map(toApiSubmission));
  } catch (err) {
    fail(res, err, 'submission list');
  }
});

// PATCH /api/admin/submissions/:id — approve or reject.
// Only 'approved' rows reach GET /api/submissions, so this is the gate between a
// submission existing and it being votable.
router.patch('/submissions/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    res.status(400).json({ error: 'Submission id must be a positive integer' });
    return;
  }

  const { status } = (req.body ?? {}) as { status?: unknown };
  if (typeof status !== 'string' || !(REVIEW_DECISIONS as readonly string[]).includes(status)) {
    res.status(400).json({ error: `status must be one of ${REVIEW_DECISIONS.join(', ')}` });
    return;
  }

  // requireAdmin guarantees req.user, but the type does not know that.
  const reviewer = req.user;
  if (!reviewer) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const updated = await review(Number(req.params.id), status as ReviewDecision, reviewer.id);
    if (!updated) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }
    res.json({ ok: true, submission: toApiSubmission(updated) });
  } catch (err) {
    fail(res, err, 'submission review');
  }
});

// ── Country allowlist (C4) ───────────────────────────────────────────────────
//
// These replace ELIGIBLE_COUNTRY, which was a constant in repo/users.ts. Enabling a
// country here is what lets its players submit and vote; the capability gates and the
// canSubmit / canVote flags on ApiUser all read this table through the same cache, so they
// cannot drift.
//
// NOTHING STOPS AN ADMINISTRATOR DISABLING EVERY COUNTRY, on purpose. It is a legitimate
// way to pause participation, it locks nobody out of administration — requireAdmin is
// requireAuth plus is_admin, not eligibility — and C5 will let individuals be granted
// back. Refusing the action would be guessing at intent.

router.get('/countries', async (_req, res) => {
  try {
    const rows = await listCountries();
    res.json(rows.map(toApiAllowedCountry));
  } catch (err) {
    fail(res, err, 'country allowlist read');
  }
});

router.put('/countries/:code', async (req, res) => {
  const { code } = req.params;
  if (!isCountryCode(code)) {
    res.status(400).json({ error: 'Country must be a two-letter ISO 3166-1 alpha-2 code' });
    return;
  }

  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be true or false' });
    return;
  }

  // requireAdmin guarantees req.user, but the type does not know that.
  const admin = req.user;
  if (!admin) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const row = await setCountryEnabled(code, enabled, admin.id);
    res.json({ ok: true, country: toApiAllowedCountry(row) });
  } catch (err) {
    fail(res, err, 'country allowlist write');
  }
});

// Distinct from disabling: this is for a code typed by mistake, where a disabled 'XZ'
// row would be noise rather than the record of a decision that a disabled 'TN' is.
router.delete('/countries/:code', async (req, res) => {
  const { code } = req.params;
  if (!isCountryCode(code)) {
    res.status(400).json({ error: 'Country must be a two-letter ISO 3166-1 alpha-2 code' });
    return;
  }

  try {
    const removed = await removeCountry(code);
    if (!removed) {
      res.status(404).json({ error: `${normaliseCountry(code)} is not on the allowlist` });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'country allowlist delete');
  }
});

// ── Per-participant permissions (C5) ─────────────────────────────────────────
//
// Manual controls applied after an investigation, not an automatic punishment system.
// Submitting and voting are set INDEPENDENTLY, and each flag is three-valued: null means
// "no override, the country allowlist decides", true grants, false refuses. An override
// wins in both directions, which is why it cannot be modelled as a ban list.
//
// A BLOCK IS FORWARD-ONLY. Nothing here touches the votes table — a validly cast vote is
// counted permanently, and only an explicit result correction (D4) changes a recorded
// result. Blocking somebody stops them voting again; it does not un-cast what they cast.

router.get('/users', async (_req, res) => {
  try {
    const [rows, allowed] = await Promise.all([listAllWithOverrides(), enabledSet()]);
    res.json(rows.map((row) => toApiAdminUser(row, allowed)));
  } catch (err) {
    fail(res, err, 'user roster read');
  }
});

/** Every override, with the account it applies to — the Eligibility tab's exception list. */
router.get('/participants', async (_req, res) => {
  try {
    const rows = await listOverrides();
    res.json(
      rows.map((row) => ({
        userId: row.user_id,
        username: row.username,
        osuId: Number(row.osu_id),
        country: row.country_code.trim(),
        avatarUrl: row.avatar_url ?? '',
        canSubmit: row.can_submit,
        canVote: row.can_vote,
        note: row.note,
        setBy: row.set_by,
        setByName: row.set_by_name,
        setAt: row.set_at.toISOString(),
      }))
    );
  } catch (err) {
    fail(res, err, 'permission override read');
  }
});

/** Accepts true, false, or null for each capability. null clears that one only. */
function readFlag(value: unknown): boolean | null | undefined {
  if (value === null || typeof value === 'boolean') return value;
  return undefined;
}

router.put('/participants/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: 'userId must be a positive integer' });
    return;
  }

  const { canSubmit, canVote, note } = (req.body ?? {}) as Record<string, unknown>;
  const submit = readFlag(canSubmit);
  const vote = readFlag(canVote);
  if (submit === undefined || vote === undefined) {
    res.status(400).json({ error: 'canSubmit and canVote must each be true, false, or null' });
    return;
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    res.status(400).json({ error: 'note must be a string or null' });
    return;
  }
  // A row that overrides nothing is not a record of anything, and it would sit in the
  // exception list saying that an administrator decided to change nothing.
  if (submit === null && vote === null) {
    res.status(400).json({
      error: 'Set at least one of canSubmit or canVote. To clear both, delete the override.',
    });
    return;
  }

  // requireAdmin guarantees req.user, but the type does not know that.
  const admin = req.user;
  if (!admin) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    // A real foreign key, so a bad id has to be caught before the insert rather than
    // surfacing as a 23503 the caller cannot read.
    const target = await findUserById(userId);
    if (!target) {
      res.status(404).json({ error: 'No such account. A player must have signed in at least once.' });
      return;
    }

    const row = await upsertOverride(
      userId,
      { canSubmit: submit, canVote: vote, note: typeof note === 'string' && note.trim() !== '' ? note.trim() : null },
      admin.id
    );
    res.json({ ok: true, override: toApiOverride(row) });
  } catch (err) {
    fail(res, err, 'permission override write');
  }
});

/** Removes the override entirely, so the country rule applies to that account again. */
router.delete('/participants/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: 'userId must be a positive integer' });
    return;
  }

  try {
    const removed = await removeOverride(userId);
    if (!removed) {
      res.status(404).json({ error: 'That account has no override to clear' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'permission override delete');
  }
});

// ── Submission rules (C8) and the mod / challenge-type lists (C9) ────────────
//
// One global row, id = 1 (decided 2026-09-05). The `rules` tab owns the star, length and
// status half; the `challenge` tab owns the two lists. Both PUT the same endpoint, and the
// write is a PATCH so saving one tab cannot silently rewrite the other's fields with whatever
// it last rendered.

/** numeric(4,2) holds up to 99.99, and no osu! beatmap is anywhere near that. */
const MAX_STARS = 99.99;
/** Ten hours. A bound so a typo cannot store a length no beatmap could ever satisfy. */
const MAX_LENGTH_SECONDS = 36_000;

/** A nullable bound: absent leaves it alone, null clears it, a number sets it. */
function readBound(
  value: unknown,
  max: number,
  integer: boolean
): number | null | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) return 'invalid';
  if (integer && !Number.isInteger(n)) return 'invalid';
  return n;
}

/** A list of distinct non-empty labels, or null when the caller sent something unusable. */
function readList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item !== '' && item.length <= 48);
  if (cleaned.length !== value.length || cleaned.length === 0 || cleaned.length > max) return null;
  return [...new Set(cleaned)];
}

router.get('/settings', async (_req, res) => {
  try {
    res.json(await settings());
  } catch (err) {
    fail(res, err, 'settings read');
  }
});

router.put('/settings', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: SiteSettingsPatch = {};

  const bounds: [keyof SiteSettingsPatch, unknown, number, boolean][] = [
    ['minStars', body.minStars, MAX_STARS, false],
    ['maxStars', body.maxStars, MAX_STARS, false],
    ['minLengthSeconds', body.minLengthSeconds, MAX_LENGTH_SECONDS, true],
    ['maxLengthSeconds', body.maxLengthSeconds, MAX_LENGTH_SECONDS, true],
  ];
  for (const [key, raw, max, integer] of bounds) {
    const read = readBound(raw, max, integer);
    if (read === 'invalid') {
      res.status(400).json({ error: `${key} must be a number between 0 and ${max}, or null` });
      return;
    }
    if (read !== undefined) (patch as Record<string, unknown>)[key] = read;
  }

  const lists: [keyof SiteSettingsPatch, unknown, number, string][] = [
    ['allowedStatuses', body.allowedStatuses, 8, 'status'],
    ['allowedMods', body.allowedMods, 32, 'mod'],
    ['allowedChallengeTypes', body.allowedChallengeTypes, 32, 'challenge type'],
  ];
  for (const [key, raw, max, label] of lists) {
    if (raw === undefined) continue;
    const read = readList(raw, max);
    if (read === null) {
      res.status(400).json({ error: `${key} must be a list of 1 to ${max} distinct ${label} names` });
      return;
    }
    (patch as Record<string, unknown>)[key] = read;
  }

  // Narrowing only. Widening past SUBMITTABLE_STATUSES would need the
  // submissions_map_status_valid CHECK changed too, so the insert would refuse a row the
  // lookup had already accepted — a rule that contradicts itself between two requests.
  if (patch.allowedStatuses) {
    const unknown = patch.allowedStatuses.filter(
      (s) => !(CONFIGURABLE_STATUSES as readonly string[]).includes(s)
    );
    if (unknown.length > 0) {
      res.status(400).json({
        error: `Only ${CONFIGURABLE_STATUSES.join(', ')} can be allowed. Unknown: ${unknown.join(', ')}`,
      });
      return;
    }
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'Nothing to change' });
    return;
  }

  // requireAdmin guarantees req.user, but the type does not know that.
  const admin = req.user;
  if (!admin) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const current = await settings();
    const minStars = patch.minStars !== undefined ? patch.minStars : current.minStars;
    const maxStars = patch.maxStars !== undefined ? patch.maxStars : current.maxStars;
    const minLen = patch.minLengthSeconds !== undefined ? patch.minLengthSeconds : current.minLengthSeconds;
    const maxLen = patch.maxLengthSeconds !== undefined ? patch.maxLengthSeconds : current.maxLengthSeconds;

    // Checked against the MERGED row, not against the patch: sending only a new minimum can
    // still cross a maximum that was already stored, and the result would be a range no
    // beatmap can satisfy with no obvious cause.
    if (minStars !== null && maxStars !== null && minStars > maxStars) {
      res.status(400).json({ error: 'The minimum star rating cannot be above the maximum' });
      return;
    }
    if (minLen !== null && maxLen !== null && minLen > maxLen) {
      res.status(400).json({ error: 'The minimum length cannot be above the maximum' });
      return;
    }

    res.json({ ok: true, settings: await update(patch, admin.id) });
  } catch (err) {
    fail(res, err, 'settings write');
  }
});

// ── Server configuration, read-only (C7 phase two) ──────────────────────────
//
// The config tab used to offer a Discord webhook input, a site name, a
// "Max Submissions Per User / Round" number, and a maintenance-mode switch, none of which
// saved anything. Three of those were deleted rather than built (decided 2026-09-05): they
// correspond to nothing in my_plan.txt or the roadmap, and max-submissions is not a setting
// that exists at all — submissions_one_per_user_per_round fixes it at one.
//
// The webhook stays a server environment variable and is NOT editable here. It is a secret,
// and an admin endpoint that accepted one would mean a credential arriving over HTTP and
// being stored somewhere it can be read back. So this reports only whether one is set, which
// is the thing an administrator actually needs to know.

router.get('/config', (_req, res) => {
  res.json({
    discordConfigured: isConfigured(),
    clientOrigin: env.clientOrigin,
    publicBaseUrl: env.publicBaseUrl,
    secureCookies: env.useSecureCookies,
    adminCount: env.adminOsuIds.length,
  });
});

// ── Result correction (D4) ───────────────────────────────────────────────────
//
// The only path that changes a recorded winner. A reason is REQUIRED: D4 exists so that a
// correction is explicit and visible rather than a silent UPDATE, and an unexplained
// correction is the silent case wearing a timestamp.

/** Why a correction was refused, in words an administrator can act on. */
const CORRECTION_REFUSALS: Record<'no-result' | 'not-in-round' | 'unchanged', string> = {
  'no-result':
    'This round has no recorded winner to correct. Close the ballot first, or resolve the tie through the winner approval.',
  'not-in-round': 'That submission is not an entry in this round',
  unchanged: 'That entry is already the recorded winner',
};

router.get('/round/corrections', async (req, res) => {
  // Same shape as GET /votes: no roundId means the open round, and no open round means an
  // empty history rather than a 404 for a question that simply has no subject yet.
  const raw = req.query.roundId;
  let roundId: number;

  if (raw === undefined) {
    const open = await findCurrent().catch(() => null);
    if (!open) {
      res.json([]);
      return;
    }
    roundId = open.id;
  } else if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    roundId = Number(raw);
  } else {
    res.status(400).json({ error: 'roundId must be a positive integer' });
    return;
  }

  try {
    const rows = await listCorrections(roundId);
    res.json(
      rows.map((row) => ({
        id: row.id,
        roundId: row.round_id,
        previousSubmissionId: row.previous_submission_id,
        previousTitle: row.previous_title,
        newSubmissionId: row.new_submission_id,
        newTitle: row.new_title,
        previousWinnerStatus: row.previous_winner_status,
        reason: row.reason,
        correctedBy: row.corrected_by,
        correctedByName: row.corrected_by_name,
        correctedAt: row.corrected_at.toISOString(),
      }))
    );
  } catch (err) {
    fail(res, err, 'corrections read');
  }
});

router.post('/round/correction', async (req, res) => {
  const { submissionId, reason } = (req.body ?? {}) as Record<string, unknown>;

  const id = Number(submissionId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'submissionId must be a positive integer' });
    return;
  }
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    res.status(400).json({
      error: 'A reason of at least 10 characters is required — a correction has to say why.',
    });
    return;
  }

  // requireAdmin guarantees req.user, but the type does not know that.
  const admin = req.user;
  if (!admin) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const round = await findCurrent();
    if (!round) {
      res.status(409).json({ error: 'No round is open' });
      return;
    }

    const outcome = await correctWinner(round.id, id, reason.trim(), admin.id);
    if (!outcome.ok) {
      res.status(409).json({ error: CORRECTION_REFUSALS[outcome.reason] });
      return;
    }

    // Announced, because the community was already told the previous answer. A correction
    // nobody hears about leaves the wrong winner standing everywhere but the database.
    const entry =
      outcome.round.winning_submission_id === null
        ? null
        : await findSubmission(outcome.round.winning_submission_id);
    announceCorrection(outcome.round, entry, reason.trim());

    res.json({ ok: true, round: toApiRound(outcome.round) });
  } catch (err) {
    fail(res, err, 'result correction');
  }
});

// POST /api/admin/users/:userId/revoke — end every session an account holds (G6).
//
// The administrator half of the same mechanism. C5's per-capability blocks are forward-only
// and do not touch a session already in flight, which is exactly the gap G6 records: an
// account blocked mid-round keeps whatever page it already has open until its cookie expires.
// This ends that immediately.
//
// Deliberately SEPARATE from setting a block rather than folded into it. A revocation signs
// somebody out of every device, which is a different act from refusing them a vote, and
// bundling the two would mean an administrator adjusting one capability silently kicked the
// player out of the site.

router.post('/users/:userId/revoke', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: 'userId must be a positive integer' });
    return;
  }

  try {
    const epoch = await revokeSessions(userId);
    if (epoch === null) {
      res.status(404).json({ error: 'No such account' });
      return;
    }
    res.json({ ok: true, sessionEpoch: epoch });
  } catch (err) {
    fail(res, err, 'session revocation');
  }
});

export default router;



