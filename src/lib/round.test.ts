import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  isBallotOpen,
  pageAccess,
  toCurrentRound,
  type CurrentRound,
} from './round';
import type { ApiRound } from '../api/client';

// The round shapes these use are minimal on purpose: each test names only the fields
// the function under test reads, so a test failing points at a rule rather than at a
// fixture that drifted.

const apiRound = (over: Partial<ApiRound> = {}): ApiRound => ({
  id: 1,
  roundNumber: 4,
  phase: 'voting',
  month: 'September',
  year: 2026,
  reward: 'One month of osu!supporter',
  submissionEndsAt: '2026-09-10T00:00:00.000Z',
  votingEndsAt: '2026-09-13T00:00:00.000Z',
  challengeEndsAt: '2026-10-04T00:00:00.000Z',
  winnerStatus: 'none',
  winningSubmissionId: null,
  winnerVoteCount: null,
  totalVotes: null,
  winnerApprovedAt: null,
  dzppFinalizedAt: null,
  ...over,
});

const round = (over: Partial<CurrentRound> = {}): CurrentRound => ({
  id: 1,
  roundNumber: 4,
  phase: 'voting',
  month: 'September',
  year: 2026,
  reward: '',
  endsAt: null,
  schedule: { submission: null, voting: null, challenge: null },
  winnerStatus: 'none',
  winningSubmissionId: null,
  winnerVoteCount: null,
  totalVotes: null,
  ...over,
});

describe('formatCountdown', () => {
  const now = Date.parse('2026-09-05T12:00:00.000Z');

  it('has nothing to count down to without a deadline', () => {
    expect(formatCountdown(null, now)).toBe('—');
    expect(formatCountdown(undefined, now)).toBe('—');
  });

  it('refuses an unparseable timestamp rather than printing NaN', () => {
    expect(formatCountdown('not a date', now)).toBe('—');
  });

  it('says ended once the deadline has passed, including exactly on it', () => {
    expect(formatCountdown('2026-09-05T11:59:00.000Z', now)).toBe('ended');
    expect(formatCountdown('2026-09-05T12:00:00.000Z', now)).toBe('ended');
  });

  it('drops to coarser units as the deadline recedes', () => {
    expect(formatCountdown('2026-09-07T14:00:00.000Z', now)).toBe('2d 2h');
    expect(formatCountdown('2026-09-05T15:04:00.000Z', now)).toBe('3h 04m');
    expect(formatCountdown('2026-09-05T12:12:00.000Z', now)).toBe('12m');
  });
});

describe('pageAccess', () => {
  it('leaves pages with no phase requirement always open', () => {
    expect(pageAccess('dashboard', null).state).toBe('open');
    expect(pageAccess('archive', round({ phase: 'submission' })).state).toBe('open');
  });

  it('opens each gated page in its own phase', () => {
    expect(pageAccess('submit', round({ phase: 'submission' })).state).toBe('open');
    expect(pageAccess('vote', round({ phase: 'voting' })).state).toBe('open');
  });

  it('tells early from closed, so the panel can say which way the round moved', () => {
    expect(pageAccess('vote', round({ phase: 'submission' }))).toEqual({
      state: 'early',
      required: 'voting',
      actual: 'submission',
    });
    expect(pageAccess('submit', round({ phase: 'voting' }))).toEqual({
      state: 'closed',
      required: 'submission',
      actual: 'voting',
    });
  });

  it('reports no round rather than a phase mismatch when nothing is open', () => {
    expect(pageAccess('vote', null)).toEqual({ state: 'no-round', required: 'voting' });
  });
});

describe('isBallotOpen', () => {
  it('is open only while the round is voting and no winner has been recorded', () => {
    expect(isBallotOpen(round({ phase: 'voting', winnerStatus: 'none' }))).toBe(true);
  });

  // The regression this function exists to prevent: the phase stays 'voting' through
  // the pending and tiebreak window, so reading the phase alone would keep the ballot
  // open after the server had already stopped honouring casts and retractions.
  it('is closed once a winner is pending or the round is tied', () => {
    expect(isBallotOpen(round({ phase: 'voting', winnerStatus: 'pending' }))).toBe(false);
    expect(isBallotOpen(round({ phase: 'voting', winnerStatus: 'tiebreak' }))).toBe(false);
  });

  it('is closed outside the voting phase and with no round at all', () => {
    expect(isBallotOpen(round({ phase: 'submission' }))).toBe(false);
    expect(isBallotOpen(round({ phase: 'challenge', winnerStatus: 'official' }))).toBe(false);
    expect(isBallotOpen(null)).toBe(false);
  });
});

describe('toCurrentRound', () => {
  it('treats an ended round as no current round', () => {
    expect(toCurrentRound(apiRound({ phase: 'ended' }))).toBeNull();
    expect(toCurrentRound(null)).toBeNull();
  });

  it('picks the deadline belonging to the phase the round is in', () => {
    expect(toCurrentRound(apiRound({ phase: 'submission' }))?.endsAt).toBe(
      '2026-09-10T00:00:00.000Z'
    );
    expect(toCurrentRound(apiRound({ phase: 'challenge' }))?.endsAt).toBe(
      '2026-10-04T00:00:00.000Z'
    );
  });

  it('carries the winner fields through, since the ballot state depends on them', () => {
    const mapped = toCurrentRound(
      apiRound({ winnerStatus: 'tiebreak', winnerVoteCount: 7, totalVotes: 19 })
    );
    expect(mapped?.winnerStatus).toBe('tiebreak');
    expect(mapped?.winnerVoteCount).toBe(7);
    expect(mapped?.totalVotes).toBe(19);
    expect(isBallotOpen(mapped)).toBe(false);
  });
});
