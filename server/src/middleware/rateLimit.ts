// A small in-process rate limiter.
//
// No dependency and no store: this API runs as one process, so a Map keyed on the
// account is enough, and a limiter that forgets everything on restart is the honest
// trade for keeping the deployment a single process. If this ever runs behind more than
// one instance, each will enforce its own share of the limit and this comment is the
// place to start.
//
// Keyed on the account, never the IP. Every route below requires a session, so the
// account is the thing worth limiting: an IP is shared by a household or a campus, and
// limiting it would punish a community that mostly plays from a handful of networks.

import type { NextFunction, Request, Response } from 'express';

interface Window {
  /** When the current window started, in epoch milliseconds. */
  start: number;
  count: number;
}

/**
 * Allows `limit` requests per `windowMs` per account, answering 429 beyond that.
 *
 * A fixed window rather than a sliding one: the boundary is a little generous but it
 * costs one number per account, and the point here is to stop a loop, not to shape
 * traffic precisely.
 */
export function rateLimit(options: { limit: number; windowMs: number; what: string }) {
  const seen = new Map<number, Window>();

  return function limiter(req: Request, res: Response, next: NextFunction): void {
    // Unauthenticated requests are the auth middleware's problem, not this one's; they
    // never reach a limited route without a session anyway.
    const account = req.user?.id;
    if (account === undefined) {
      next();
      return;
    }

    const now = Date.now();
    const window = seen.get(account);

    if (window === undefined || now - window.start >= options.windowMs) {
      seen.set(account, { start: now, count: 1 });
      sweep(seen, now, options.windowMs);
      next();
      return;
    }

    window.count += 1;
    if (window.count > options.limit) {
      const retryAfter = Math.ceil((window.start + options.windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: `Too many ${options.what}. Wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} and try again.`,
      });
      return;
    }

    next();
  };
}

/**
 * Drops windows that have expired, so a long-running process does not accumulate one
 * entry per account that ever used the route. Runs on the cheap path — the first
 * request of a new window — rather than on a timer nothing would ever clear.
 */
function sweep(seen: Map<number, Window>, now: number, windowMs: number): void {
  if (seen.size < 256) return;
  for (const [account, window] of seen) {
    if (now - window.start >= windowMs) seen.delete(account);
  }
}
