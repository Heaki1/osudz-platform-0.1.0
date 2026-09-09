// osu! OAuth2 login.
//
// Flow: /login issues a state nonce and redirects to osu!; osu! redirects the
// browser back to /callback with a code; /callback verifies the state, trades the
// code for a token, reads the profile, upserts the user, sets the session cookie,
// and sends the browser back to the SPA.
//
// The redirect target is PUBLIC_BASE_URL (the Vite origin, 8443), not this
// server's port — /api is proxied, so the whole round trip stays on one origin
// and the session cookie is first-party.

import { Router } from 'express';
import { env } from '../env.js';
import { authorizeUrl, exchangeCode, fetchMe } from '../services/osu.js';
import {
  issueState,
  consumeState,
  setSession,
  readSession,
  clearSession,
} from '../session.js';
import { requireAuth } from '../middleware/auth.js';
import { enabledSet } from '../repo/allowedCountries.js';
import { findForUser } from '../repo/participantPermissions.js';
import { upsertFromOsu, findByOsuId, revokeSessions, toApiUser } from '../repo/users.js';

const router = Router();

// GET /api/auth/login — redirect to osu! for authorization
router.get('/login', (_req, res) => {
  res.redirect(authorizeUrl(issueState(res)));
});

// GET /api/auth/callback — osu! sends the browser here with ?code&state
router.get('/callback', async (req, res) => {
  // Failures land back on the SPA with a reason rather than showing raw JSON.
  const fail = (reason: string) =>
    res.redirect(`${env.publicBaseUrl}/?auth=failed&reason=${encodeURIComponent(reason)}`);

  if (typeof req.query.error === 'string') return fail(req.query.error);
  if (!consumeState(req, res, req.query.state)) return fail('state_mismatch');

  const code = req.query.code;
  if (typeof code !== 'string' || code === '') return fail('missing_code');

  try {
    const me = await fetchMe(await exchangeCode(code));
    if (me.is_restricted) return fail('account_restricted');

    const user = await upsertFromOsu(me);
    // The cookie carries the account's current revocation epoch (G6), so a session minted
    // before a revocation is not accepted after it.
    setSession(res, Number(user.osu_id), user.session_epoch);
    return res.redirect(env.publicBaseUrl);
  } catch (err) {
    console.error('[auth] callback failed:', err instanceof Error ? err.message : err);
    return fail('login_failed');
  }
});

// GET /api/auth/me — the session user, or null when signed out
router.get('/me', async (req, res) => {
  const osuId = readSession(req);
  if (osuId === null) return res.json(null);

  try {
    const user = await findByOsuId(osuId);
    if (!user) return res.json(null);
    // canSubmit and canVote have to agree with the gates that refuse the writes, so they
    // resolve through the same allowlist (C4) and the same per-player override (C5).
    const [allowed, override] = await Promise.all([enabledSet(), findForUser(user.id)]);
    return res.json(toApiUser(user, allowed, override));
  } catch (err) {
    console.error('[auth] /me lookup failed:', err instanceof Error ? err.message : err);
    return res.status(503).json({ error: 'Database unavailable' });
  }
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// POST /api/auth/logout-all — end every session this account holds (G6).
//
// The plain logout only clears this browser's cookie, which is all a stateless session can do
// locally: a copy taken from another device stays valid for its full thirty days. This moves
// the account's revocation epoch, so every cookie minted before now is refused on its next
// request — the thing the scheme could not do at all before.
//
// The caller is then handed a FRESH cookie rather than being signed out of the tab they
// clicked in. Ending your other sessions and ending this one are different intentions, and the
// second already has a button.
router.post('/logout-all', requireAuth, async (req, res) => {
  try {
    const epoch = await revokeSessions(req.user!.id);
    if (epoch === null) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    setSession(res, Number(req.user!.osu_id), epoch);
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] revoke failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

export default router;
