import { describe, expect, it } from 'vitest';
import { isCountryCode, normalise } from './allowedCountries.js';
import { canEnterChallenge, canParticipate, isEligible, type UserRow } from './users.js';

const user = (country: string): UserRow => ({
  id: 1,
  osu_id: '4907876',
  username: 'someone',
  country_code: country,
  avatar_url: null,
  global_rank: null,
  is_admin: false,
  session_epoch: 0,
});

/** What repo/allowedCountries.ts enabledSet() hands over: normalised, upper case. */
const allowlist = (...codes: string[]) => new Set(codes);

describe('isEligible', () => {
  it('accepts a country that is on the allowlist', () => {
    expect(isEligible(user('DZ'), allowlist('DZ'))).toBe(true);
  });

  // country_code is char(2), which Postgres blank-pads, and osu! is not guaranteed to
  // send it uppercase. Both of those bit this rule once, hence the trim and the fold.
  it('tolerates padding and case, because the column and the API both vary', () => {
    expect(isEligible(user('dz'), allowlist('DZ'))).toBe(true);
    expect(isEligible(user(' DZ '), allowlist('DZ'))).toBe(true);
    expect(isEligible(user('dz  '), allowlist('DZ'))).toBe(true);
  });

  it('refuses a country that is not on it', () => {
    expect(isEligible(user('FR'), allowlist('DZ'))).toBe(false);
    expect(isEligible(user('TN'), allowlist('DZ'))).toBe(false);
    expect(isEligible(user(''), allowlist('DZ'))).toBe(false);
  });

  // The whole point of C4: a second country is a row, not a code change.
  it('accepts any of several enabled countries', () => {
    const enabled = allowlist('DZ', 'TN', 'MA');
    expect(isEligible(user('TN'), enabled)).toBe(true);
    expect(isEligible(user('ma'), enabled)).toBe(true);
    expect(isEligible(user('EG'), enabled)).toBe(false);
  });

  // An administrator disabling everything is a legitimate way to pause participation, so
  // it has to refuse everyone rather than fall back to a hardcoded country.
  it('refuses everyone when nothing is enabled', () => {
    expect(isEligible(user('DZ'), allowlist())).toBe(false);
  });
});

describe('allowedCountries helpers', () => {
  it('normalises the way isEligible does, so the two cannot disagree', () => {
    expect(normalise('dz')).toBe('DZ');
    expect(normalise(' DZ ')).toBe('DZ');
    // char(2) blank-pads, so a value read back out of the column arrives padded.
    expect(normalise('dz  ')).toBe('DZ');
  });

  it('accepts only two ASCII letters as a country code', () => {
    expect(isCountryCode('DZ')).toBe(true);
    expect(isCountryCode('tn')).toBe(true);
    expect(isCountryCode(' MA ')).toBe(true);
    expect(isCountryCode('DZA')).toBe(false);
    expect(isCountryCode('D')).toBe(false);
    expect(isCountryCode('D1')).toBe(false);
    expect(isCountryCode('')).toBe(false);
    expect(isCountryCode(undefined)).toBe(false);
    expect(isCountryCode(12)).toBe(false);
  });
});

describe('canParticipate', () => {
  const dz = () => user('DZ');
  const fr = () => user('FR');
  const enabled = allowlist('DZ');

  it('falls back to the country rule when there is no override', () => {
    expect(canParticipate('submit', dz(), enabled, null)).toBe(true);
    expect(canParticipate('vote', dz(), enabled, null)).toBe(true);
    expect(canParticipate('submit', fr(), enabled, null)).toBe(false);
    expect(canParticipate('vote', fr(), enabled, null)).toBe(false);
  });

  // C5's own VERIFY: block voting for an eligible account and it must still be able to
  // submit. This is the case a single "banned" flag could not express.
  it('blocks one capability without touching the other', () => {
    const blockedFromVoting = { can_submit: null, can_vote: false };
    expect(canParticipate('vote', dz(), enabled, blockedFromVoting)).toBe(false);
    expect(canParticipate('submit', dz(), enabled, blockedFromVoting)).toBe(true);

    const blockedFromSubmitting = { can_submit: false, can_vote: null };
    expect(canParticipate('submit', dz(), enabled, blockedFromSubmitting)).toBe(false);
    expect(canParticipate('vote', dz(), enabled, blockedFromSubmitting)).toBe(true);
  });

  // An override wins in BOTH directions, which is why this cannot be "country AND not
  // blocked": a diaspora player granted a vote is the case my_plan.txt asks for.
  it('grants a capability the country rule would refuse', () => {
    const granted = { can_submit: null, can_vote: true };
    expect(canParticipate('vote', fr(), enabled, granted)).toBe(true);
    expect(canParticipate('submit', fr(), enabled, granted)).toBe(false);
  });

  it('refuses a capability even when the country rule allows it', () => {
    expect(canParticipate('vote', dz(), enabled, { can_submit: true, can_vote: false })).toBe(false);
  });

  // A row overriding nothing is refused by the route, but the rule still has to behave: it
  // means the country allowlist decides, not that everything is denied.
  it('treats an all-null override as no override at all', () => {
    const empty = { can_submit: null, can_vote: null };
    expect(canParticipate('vote', dz(), enabled, empty)).toBe(true);
    expect(canParticipate('vote', fr(), enabled, empty)).toBe(false);
  });

  // false is a meaningful value, so the resolver must not treat it as "unset" — the bug a
  // truthiness check would introduce.
  it('honours false rather than reading it as unset', () => {
    expect(canParticipate('submit', dz(), enabled, { can_submit: false, can_vote: false })).toBe(false);
    expect(canParticipate('vote', dz(), enabled, { can_submit: false, can_vote: false })).toBe(false);
  });
});

// C5's loose end, closed: the challenge belonged to neither capability, so a player blocked
// from both could still play the winning map and win the month's prize.
describe('canEnterChallenge', () => {
  const dz = () => user('DZ');
  const fr = () => user('FR');
  const enabled = allowlist('DZ');

  it('falls back to the country rule when there is no override', () => {
    expect(canEnterChallenge(dz(), enabled, null)).toBe(true);
    expect(canEnterChallenge(fr(), enabled, null)).toBe(false);
  });

  // The hole this rule exists to close.
  it('refuses an account blocked from both submitting and voting', () => {
    expect(canEnterChallenge(dz(), enabled, { can_submit: false, can_vote: false })).toBe(false);
  });

  // The same statement inverted. An administrator who granted a diaspora player both
  // capabilities has said they take part, so refusing the prize would be the mirror hole.
  it('allows an account granted both, whatever its country', () => {
    expect(canEnterChallenge(fr(), enabled, { can_submit: true, can_vote: true })).toBe(true);
  });

  // The reason this is not canParticipate('submit') && canParticipate('vote'): a partial
  // block says nothing about the challenge, so the country rule still decides.
  it('leaves a partial override to the country rule', () => {
    expect(canEnterChallenge(dz(), enabled, { can_submit: false, can_vote: null })).toBe(true);
    expect(canEnterChallenge(dz(), enabled, { can_submit: null, can_vote: false })).toBe(true);
    expect(canEnterChallenge(dz(), enabled, { can_submit: true, can_vote: false })).toBe(true);
    expect(canEnterChallenge(fr(), enabled, { can_submit: null, can_vote: true })).toBe(false);
    expect(canEnterChallenge(fr(), enabled, { can_submit: true, can_vote: null })).toBe(false);
  });

  it('treats an all-null override as no override at all', () => {
    const empty = { can_submit: null, can_vote: null };
    expect(canEnterChallenge(dz(), enabled, empty)).toBe(true);
    expect(canEnterChallenge(fr(), enabled, empty)).toBe(false);
  });

  // Pausing participation has to pause the challenge too, rather than falling back to a
  // hardcoded country the way the pre-C4 constant would have.
  it('refuses everyone when no country is enabled and no override grants both', () => {
    expect(canEnterChallenge(dz(), allowlist(), null)).toBe(false);
    expect(canEnterChallenge(dz(), allowlist(), { can_submit: true, can_vote: null })).toBe(false);
    expect(canEnterChallenge(dz(), allowlist(), { can_submit: true, can_vote: true })).toBe(true);
  });
});
