// The open round, as the UI sees it.
//
// One narrowing point for the whole app: the server's ApiRound carries four
// phases and three scheduled end timestamps, while every component wants a live
// Phase and a single "ends in" value. toCurrentRound collapses that, so no
// component has to remember which of the three timestamps applies.

import { useEffect, useState } from 'react';
import { ApiRound } from '../api/client';
import { Phase, PlatformPage } from '../types';

export interface CurrentRound {
  id: number;
  roundNumber: number;
  /** Never 'ended' — an ended round is not current, so it reads as null. */
  phase: Phase;
  month: string;
  year: number;
  /** '' when the round has no reward set. */
  reward: string;
  /** Scheduled end of the phase the round is in, ISO 8601, or null if unscheduled. */
  endsAt: string | null;
  /** All three scheduled ends, for the admin schedule view. */
  schedule: Record<Phase, string | null>;
  /**
   * How far the winner has got. The phase stays 'voting' while this is 'pending' or
   * 'tiebreak', so this — not the phase — says whether the ballot is still open.
   */
  winnerStatus: ApiRound['winnerStatus'];
  /** Null until the winner is determined, and while a tie is unresolved. */
  winningSubmissionId: number | null;
  /** Frozen when voting closed. On a tie, the count every tied entry reached. */
  winnerVoteCount: number | null;
  /** Votes cast in the round, frozen alongside winnerVoteCount. */
  totalVotes: number | null;
}

const LIVE_PHASES: readonly Phase[] = ['submission', 'voting', 'challenge'];

const isLivePhase = (phase: ApiRound['phase']): phase is Phase =>
  (LIVE_PHASES as readonly string[]).includes(phase);

/**
 * GET /api/rounds/current only ever returns a non-ended round, so the 'ended'
 * branch is unreachable in practice — but the DTO allows it, and treating it as
 * "no current round" is the honest reading rather than a cast.
 */
export function toCurrentRound(round: ApiRound | null): CurrentRound | null {
  if (!round || !isLivePhase(round.phase)) return null;

  const schedule: Record<Phase, string | null> = {
    submission: round.submissionEndsAt,
    voting: round.votingEndsAt,
    challenge: round.challengeEndsAt,
  };

  return {
    id: round.id,
    roundNumber: round.roundNumber,
    phase: round.phase,
    month: round.month,
    year: round.year,
    reward: round.reward,
    endsAt: schedule[round.phase],
    schedule,
    winnerStatus: round.winnerStatus,
    winningSubmissionId: round.winningSubmissionId,
    winnerVoteCount: round.winnerVoteCount,
    totalVotes: round.totalVotes,
  };
}

/** "Round 3 · August 2026", or a placeholder when nothing is running. */
export const roundLabel = (round: CurrentRound | null): string =>
  round ? `Round ${round.roundNumber} · ${round.month} ${round.year}` : 'No active round';

/**
 * Whether a vote may still be cast or retracted.
 *
 * The phase alone does not answer this: it stays 'voting' right through the pending
 * and tiebreak window, while routes/votes.ts refuses both writes the moment
 * winnerStatus leaves 'none'. Every surface that offers a vote button reads this, so
 * the UI cannot go on offering a write the server has already closed.
 */
export const isBallotOpen = (round: CurrentRound | null): boolean =>
  round?.phase === 'voting' && round.winnerStatus === 'none';

/** An absolute deadline, for the admin schedule view. */
export const formatDeadline = (endsAt: string | null): string =>
  endsAt
    ? new Date(endsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'not scheduled';

/**
 * "2d 14h", "18h 04m", "12m", "ended" once the deadline passes, or "—" when the
 * phase has no scheduled end.
 */
export function formatCountdown(endsAt: string | null | undefined, now = Date.now()): string {
  if (!endsAt) return '—';

  const remaining = new Date(endsAt).getTime() - now;
  if (Number.isNaN(remaining)) return '—';
  if (remaining <= 0) return 'ended';

  const totalMinutes = Math.floor(remaining / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

/** formatCountdown that re-renders as the deadline approaches. */
export function useCountdown(endsAt: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [endsAt]);

  return formatCountdown(endsAt, now);
}

// ── PHASE-GATED PAGE ACCESS ──────────────────────────────────────────────────
//
// One table decides which pages are live in which phase, because two of them used
// to disagree. The submit page carried its own private "closed" component with a
// hardcoded next round in it, while the vote page had no gate at all — it rendered
// in every phase and printed the label "Voting Phase" whatever the round was doing.
// The nav reads the same table, so a tab and the page behind it cannot tell
// different stories.

/** The phase each page is interactive in. A page absent from here is always open. */
export const PAGE_PHASE: Partial<Record<PlatformPage, Phase>> = {
  submit: 'submission',
  vote: 'voting',
};

/** Where to send someone when the page they asked for is not the live one. */
export const PHASE_LANDING: Record<Phase, PlatformPage> = {
  submission: 'submit',
  voting: 'vote',
  challenge: 'dashboard',
};

export type PageAccess =
  | { state: 'open' }
  | { state: 'no-round'; required: Phase }
  | { state: 'early'; required: Phase; actual: Phase }
  | { state: 'closed'; required: Phase; actual: Phase };

/**
 * Whether `page` is live for `round`. 'early' and 'closed' are distinguished by
 * LIVE_PHASES order so the panel can say which way the round has moved; an ended
 * round arrives here as null, because toCurrentRound has already collapsed it.
 */
export function pageAccess(page: PlatformPage, round: CurrentRound | null): PageAccess {
  const required = PAGE_PHASE[page];
  if (!required) return { state: 'open' };
  if (!round) return { state: 'no-round', required };
  if (round.phase === required) return { state: 'open' };

  const isEarly = LIVE_PHASES.indexOf(round.phase) < LIVE_PHASES.indexOf(required);
  return isEarly
    ? { state: 'early', required, actual: round.phase }
    : { state: 'closed', required, actual: round.phase };
}

/** pageAccess for callers that only need the yes/no — the nav, mainly. */
export const isPageOpen = (page: PlatformPage, round: CurrentRound | null): boolean =>
  pageAccess(page, round).state === 'open';
