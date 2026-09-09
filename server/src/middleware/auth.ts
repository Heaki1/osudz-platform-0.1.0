// Route guards, kept together so the auth contract lives in one place.
// routes/admin.ts gates its whole router with requireAdmin; submissions and votes
// mount requireAuth, requireCanSubmit or requireCanVote per route.

import type { Request, Response, NextFunction } from 'express';
import { readSessionClaims } from '../session.js';
import { enabledSet } from '../repo/allowedCountries.js';
import { findForUser } from '../repo/participantPermissions.js';
import {
  canEnterChallenge,
  canParticipate,
  findByOsuId,
  type Capability,
  type CapabilityOverride,
  type UserRow,
} from '../repo/users.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth / requireAdmin. Absent on unauthenticated requests. */
      user?: UserRow;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const claims = readSessionClaims(req);
  if (claims === null) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  let user: UserRow | null;
  try {
    user = await findByOsuId(claims.osuId);
  } catch (err) {
    console.error('[auth] user lookup failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Database unavailable' });
    return;
  }

  if (!user) {
    // Signed cookie for an account that no longer exists — treat as signed out.
    res.status(401).json({ error: 'Session no longer valid' });
    return;
  }

  // G6. The cookie is still perfectly signed; it is simply older than the account's current
  // revocation epoch, which is what "this session has been ended" means without a session
  // table. Checked on EVERY authenticated request, because that is the only place a stateless
  // cookie can be refused.
  if (claims.epoch !== user.session_epoch) {
    res.status(401).json({ error: 'This session has been signed out. Log in again.' });
    return;
  }

  req.user = user;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    if (!req.user?.is_admin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  });
}

/**
 * requireAuth plus the CHALLENGE rule, resolved through canEnterChallenge.
 *
 * Used by the challenge, and only by it. Two rules layered, and both matter:
 *
 *   the country allowlist    the E2 decision — the challenge is for the same community as
 *                            the rest of the platform (docs/todo.txt E2)
 *   an unambiguous override  an account blocked from BOTH submitting and voting is blocked
 *                            here too, and one granted both is allowed here too (C5)
 *
 * A partial override does not reach the challenge: see canEnterChallenge in repo/users.ts
 * for why, and for why this is derived from the two stored capabilities rather than being a
 * third column.
 */
export async function requireCanChallenge(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  let authenticated = false;
  await requireAuth(req, res, () => {
    authenticated = true;
  });
  if (!authenticated) return; // requireAuth has already answered.

  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  let allowed: ReadonlySet<string>;
  let override: CapabilityOverride | null;
  try {
    [allowed, override] = await Promise.all([enabledSet(), findForUser(user.id)]);
  } catch (err) {
    console.error('[auth] challenge eligibility read failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Database unavailable' });
    return;
  }

  if (canEnterChallenge(user, allowed, override)) {
    next();
    return;
  }

  // Same distinction requireCapability draws: a blocked account and an ineligible country
  // call for different actions, so the refusal has to say which one applied.
  const fullyBlocked = override?.can_submit === false && override?.can_vote === false;
  res.status(403).json({
    error: fullyBlocked
      ? 'An administrator has restricted this account from taking part.'
      : countryRefusal(allowed, 'The challenge is'),
  });
}

/**
 * requireAuth plus one capability, resolved through canParticipate so this gate and the
 * canSubmit / canVote flags on ApiUser are the same sentence rather than two copies.
 *
 * Two stages written flat rather than nested: both halves are async now, and handing
 * requireAuth an async callback would leave a promise nobody awaits, so a rejection inside
 * it would surface as an unhandled rejection instead of a 503.
 */
function requireCapability(capability: Capability) {
  return async function gate(req: Request, res: Response, next: NextFunction): Promise<void> {
    let authenticated = false;
    await requireAuth(req, res, () => {
      authenticated = true;
    });
    if (!authenticated) return;

    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    let allowed: ReadonlySet<string>;
    let override: CapabilityOverride | null;
    try {
      [allowed, override] = await Promise.all([enabledSet(), findForUser(user.id)]);
    } catch (err) {
      console.error('[auth] eligibility read failed:', err instanceof Error ? err.message : err);
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    if (canParticipate(capability, user, allowed, override)) {
      next();
      return;
    }

    // Which rule refused matters to the person reading it: "your country is not on the
    // list" and "an administrator restricted your account" call for different actions.
    const blocked = capability === 'submit' ? override?.can_submit : override?.can_vote;
    res.status(403).json({
      error:
        blocked === false
          ? `An administrator has restricted this account from ${capability === 'submit' ? 'submitting' : 'voting'}.`
          : countryRefusal(allowed, 'Submitting and voting are'),
    });
  };
}

/**
 * The country refusal NAMES the countries. It used to say "Algerian osu! accounts", which
 * stops being true the moment an administrator enables a second country, and a player
 * refused without being told the rule has nothing to act on.
 *
 * The subject is the caller's, because the same rule refuses three different things and
 * "Submitting and voting are limited to..." is a lie when what was refused is a score.
 */
function countryRefusal(allowed: ReadonlySet<string>, subject: string): string {
  const list = [...allowed].sort().join(', ');
  return list
    ? `${subject} limited to these countries: ${list}`
    : `${subject} closed — no country is currently enabled`;
}

/** The gate for entering a beatmap, and for withdrawing one. */
export const requireCanSubmit = requireCapability('submit');

/** The gate for casting a vote. Retracting one is requireAuth — see routes/votes.ts. */
export const requireCanVote = requireCapability('vote');
