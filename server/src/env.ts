// Environment validation.
//
// Anything security-relevant is required at boot rather than defaulted, so a
// blank .env fails loudly instead of quietly signing sessions with undefined.

import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`FATAL  ${name} is not set. Copy server/.env.example to server/.env and fill it in.`);
    process.exit(1);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Required once NODE_ENV says production, defaulted to a localhost value before that.
 *
 * These two are not secrets, so requiring them in development would make a fresh
 * checkout fail to boot for no good reason. In production a wrong value is worse than a
 * missing one: a stale PUBLIC_BASE_URL sends every player to localhost after login, and
 * a stale CLIENT_ORIGIN refuses the real client's credentialed requests. Both fail in
 * ways that look like a broken login rather than a missing variable, so they fail loudly
 * here instead.
 */
function requiredInProduction(name: string, developmentDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) {
    console.error(`FATAL  ${name} must be set when NODE_ENV=production.`);
    process.exit(1);
  }
  return developmentDefault;
}

const publicBaseUrl = requiredInProduction('PUBLIC_BASE_URL', 'http://localhost:8443');

export const env = {
  sessionSecret: required('SESSION_SECRET'),
  osuClientId: required('OSU_CLIENT_ID'),
  osuClientSecret: required('OSU_CLIENT_SECRET'),
  /** Must match the callback URL registered on the osu! OAuth application exactly. */
  osuRedirectUri: required('OSU_REDIRECT_URI'),
  /** Where the SPA lives — the callback redirects back here when login completes. */
  publicBaseUrl,
  /**
   * The one origin allowed to make credentialed requests. Read here rather than from
   * process.env at the call site, so it is validated with everything else.
   */
  clientOrigin: requiredInProduction('CLIENT_ORIGIN', 'http://localhost:8443'),
  /** osu! account ids granted admin access. Re-evaluated on every login. */
  adminOsuIds: (process.env.ADMIN_OSU_IDS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0),
  isProduction,
  /**
   * Whether to mark cookies Secure.
   *
   * Derived from the scheme actually in use as well as NODE_ENV, because those can
   * disagree: a deploy that forgets NODE_ENV=production would otherwise send the session
   * cookie over https with no Secure flag, and nothing in the app would look broken. An
   * https base URL is the condition under which a Secure cookie works, so it is the
   * condition that sets it.
   */
  useSecureCookies: isProduction || publicBaseUrl.startsWith('https://'),
} as const;
