import { describe, expect, it } from 'vitest';
import { canTransition, isRoundPhase, refuseSkipVoting } from './rounds.js';

describe('isRoundPhase', () => {
  it('accepts the four phases and nothing else', () => {
    for (const phase of ['submission', 'voting', 'challenge', 'ended']) {
      expect(isRoundPhase(phase)).toBe(true);
    }
    expect(isRoundPhase('archived')).toBe(false);
    expect(isRoundPhase('')).toBe(false);
    expect(isRoundPhase(undefined)).toBe(false);
    expect(isRoundPhase(2)).toBe(false);
  });
});

describe('canTransition', () => {
  it('moves a round forward one step', () => {
    expect(canTransition('submission', 'voting')).toBe(true);
  });

  // The rule the winner-approval gate depends on. voting -> challenge is deliberately
  // absent, because approving a winner is what performs that move: leaving it here
  // would let PATCH /round/phase walk straight past the approval it must require.
  it('refuses voting to challenge, which only approving a winner may do', () => {
    expect(canTransition('voting', 'challenge')).toBe(false);
  });

  it('lets a round be ended from anywhere', () => {
    expect(canTransition('submission', 'ended')).toBe(true);
    expect(canTransition('voting', 'ended')).toBe(true);
    expect(canTransition('challenge', 'ended')).toBe(true);
  });

  it('refuses every backwards move', () => {
    expect(canTransition('voting', 'submission')).toBe(false);
    expect(canTransition('challenge', 'voting')).toBe(false);
    expect(canTransition('challenge', 'submission')).toBe(false);
    expect(canTransition('ended', 'submission')).toBe(false);
    expect(canTransition('ended', 'challenge')).toBe(false);
  });

  it('allows staying put, which is how a deadline gets rewritten', () => {
    expect(canTransition('voting', 'voting')).toBe(true);
    expect(canTransition('ended', 'ended')).toBe(true);
  });
});

// The zero-approved-entry case. A round can reach voting with nothing to vote on, and
// closeVoting refuses to invent a winner for it — which left the round with no way forward
// but a deadline that changes nothing. This is the rule behind the escape.
describe('refuseSkipVoting', () => {
  const voting = { phase: 'voting', winner_status: 'none' } as const;

  it('allows an empty ballot in the voting phase to be skipped', () => {
    expect(refuseSkipVoting(voting, 0)).toBe(null);
  });

  // THE GUARD, and the reason this cannot live in the client: a round with entries has a
  // real ballot, and skipping it would throw away submissions and any votes cast for them.
  it('refuses a round that has approved entries', () => {
    expect(refuseSkipVoting(voting, 1)).toBe('has-entries');
    expect(refuseSkipVoting(voting, 12)).toBe('has-entries');
  });

  it('refuses every phase but voting', () => {
    expect(refuseSkipVoting({ phase: 'submission', winner_status: 'none' }, 0)).toBe('not-voting');
    expect(refuseSkipVoting({ phase: 'challenge', winner_status: 'none' }, 0)).toBe('not-voting');
    expect(refuseSkipVoting({ phase: 'ended', winner_status: 'none' }, 0)).toBe('not-voting');
  });

  // A closed ballot is the winner-approval flow's business, and this must not reach into it.
  it('refuses a ballot that has already closed, whatever its outcome', () => {
    expect(refuseSkipVoting({ phase: 'voting', winner_status: 'pending' }, 0)).toBe('already-closed');
    expect(refuseSkipVoting({ phase: 'voting', winner_status: 'tiebreak' }, 0)).toBe('already-closed');
    expect(refuseSkipVoting({ phase: 'voting', winner_status: 'official' }, 0)).toBe('already-closed');
  });

  // Order, which is what the refusal message depends on. A closed ballot has entries too,
  // and reporting THAT would send an administrator looking for the wrong problem.
  it('reports the phase and the closed ballot before it reports entries', () => {
    expect(refuseSkipVoting({ phase: 'challenge', winner_status: 'official' }, 5)).toBe('not-voting');
    expect(refuseSkipVoting({ phase: 'voting', winner_status: 'pending' }, 5)).toBe('already-closed');
  });

  // canTransition already permitted voting -> ended; the guard is what is new. Asserted
  // together so a future edit cannot make the move illegal while leaving the guard passing.
  it('agrees with the transition table it relies on', () => {
    expect(canTransition('voting', 'ended')).toBe(true);
    expect(canTransition('voting', 'challenge')).toBe(false);
  });
});
