-- 010_session_revocation.sql — a way to invalidate a session before its 30-day expiry.
--
-- docs/todo.txt G6. server/src/session.ts is a signed stateless cookie with a 30-day
-- TTL, so logging out only clears the browser's copy: a stolen cookie stays valid for a
-- month, and blocking an account (C5) does not end the session already in flight.
--
-- A TOKEN VERSION, NOT A SESSION TABLE — which is what G6's own STEPS name. The
-- stateless cookie is a deliberate design that session.ts argues for, and a per-user
-- epoch revokes without giving it up: the epoch is sealed into the cookie and compared
-- on every authenticated request, so bumping it invalidates every cookie that account
-- holds, at the cost of one column rather than a table plus a sweep job.
--
-- WHEN WIRING THIS: a cookie minted before the column existed carries no epoch, and the
-- check must read a missing one as 0. Treating absent as invalid would sign out every
-- current session the moment the code deploys.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

ALTER TABLE users ADD COLUMN session_epoch integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.session_epoch IS 'Sealed into the session cookie and compared in middleware/auth.ts. Incrementing it revokes every session this account holds. A cookie carrying no epoch is read as 0, so existing sessions survive the change that introduces this.';
