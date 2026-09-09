// Session and OAuth-state cookies, signed with SESSION_SECRET.
//
// No session table and no session library: the cookie carries the osu! id, an expiry and a
// revocation epoch, HMAC-signed so it cannot be forged. That is enough for a site where a
// session grants one vote per month, and it is reversible — swapping in server-side sessions
// later only changes this file.
//
// THE EPOCH IS G6. A stateless cookie cannot be torn up, so revoking one used to be
// impossible: logging out only cleared the browser's copy and a stolen cookie stayed valid
// for its full thirty days. users.session_epoch is a version number sealed into the cookie
// and compared on every authenticated request, so incrementing it invalidates every cookie
// that account holds — revocation without giving up statelessness, at the cost of one column
// rather than a table and a sweep job.
//
// The state cookie implements the OAuth CSRF check: the same nonce goes out as
// the `state` parameter and comes back in the cookie, and the callback refuses
// to proceed unless they match.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from './env.js';

const SESSION_COOKIE = 'osudz_session';
const STATE_COOKIE = 'osudz_oauth_state';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** base64url — deliberately contains no '.', so it is safe as a field separator. */
function sign(payload: string): string {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
}

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function seal(payload: string): string {
  return `${payload}.${sign(payload)}`;
}

function unseal(token: string | undefined): string | null {
  if (!token) return null;
  const cut = token.lastIndexOf('.');
  if (cut <= 0) return null;
  const payload = token.slice(0, cut);
  return equal(token.slice(cut + 1), sign(payload)) ? payload : null;
}

/** Reads one cookie off the raw header — avoids a cookie-parser dependency. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/**
 * sameSite 'lax' so the cookie survives the top-level redirect back from osu!.
 *
 * secure comes from env.useSecureCookies rather than NODE_ENV directly, so an https
 * deployment that forgot NODE_ENV=production still gets a Secure cookie.
 */
function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: env.useSecureCookies, path: '/' };
}

export function setSession(res: Response, osuId: number, epoch: number): void {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  res.cookie(SESSION_COOKIE, seal(`${osuId}.${expiresAt}.${epoch}`), {
    ...cookieOptions(),
    maxAge: SESSION_TTL_MS,
  });
}

/** What a valid session cookie carries. */
export interface SessionClaims {
  osuId: number;
  /** The revocation epoch the cookie was minted with (G6). */
  epoch: number;
}

/**
 * The session's claims, or null when there is no valid unexpired cookie.
 *
 * A COOKIE WITH NO EPOCH READS AS 0, which is the default the column carries, so every
 * session minted before G6 keeps working. Treating a missing epoch as invalid would have
 * signed out every player the moment this deployed, for no security benefit — the cookie is
 * still signed, and 0 is still checked against the row.
 */
export function readSessionClaims(req: Request): SessionClaims | null {
  const payload = unseal(readCookie(req, SESSION_COOKIE));
  if (!payload) return null;
  const [rawId, rawExpiry, rawEpoch] = payload.split('.');
  const osuId = Number(rawId);
  const expiresAt = Number(rawExpiry);
  if (!Number.isInteger(osuId) || osuId <= 0) return null;
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  const epoch = rawEpoch === undefined ? 0 : Number(rawEpoch);
  if (!Number.isInteger(epoch) || epoch < 0) return null;
  return { osuId, epoch };
}

/**
 * The signed-in osu! id alone, for the one caller that does not need the epoch.
 *
 * GET /auth/me is a "who am I" probe that answers 200 with null when signed out, and it
 * re-reads the user row anyway — so it goes through requireAuth's check like everything else
 * rather than having its own.
 */
export function readSession(req: Request): number | null {
  return readSessionClaims(req)?.osuId ?? null;
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function issueState(res: Response): string {
  const nonce = randomBytes(16).toString('base64url');
  res.cookie(STATE_COOKIE, seal(nonce), { ...cookieOptions(), maxAge: STATE_TTL_MS });
  return nonce;
}

/** Single-use: clears the cookie whether or not it matched. */
export function consumeState(req: Request, res: Response, provided: unknown): boolean {
  const expected = unseal(readCookie(req, STATE_COOKIE));
  res.clearCookie(STATE_COOKIE, cookieOptions());
  return typeof provided === 'string' && expected !== null && equal(provided, expected);
}
