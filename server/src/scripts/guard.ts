// Shared target resolution + protected-database guard.
//
// Every script that can touch Postgres goes through resolveTarget() first, so a
// stray DATABASE_URL can never point this project's DDL at another project's
// database. The refusal happens before any connection is opened.

import 'dotenv/config';

/** Databases belonging to the user's other projects. Never connect to these. */
const PROTECTED = ['osudz_newdz_test', 'osudz_ppy', 'osudz_ppy_test'];

/** The only database this project may touch. Override with EXPECTED_DB. */
export const EXPECTED = process.env.EXPECTED_DB ?? 'osudz_platform';

export interface Target {
  url: string;
  host: string;
  port: string;
  dbname: string;
  user: string;
  hasPassword: boolean;
}

/**
 * Parses DATABASE_URL and refuses to continue unless it names EXPECTED.
 * Exits the process rather than throwing — these are one-shot CLI scripts and a
 * wrong target is never something a caller should be able to catch and ignore.
 */
export function resolveTarget(): Target {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('FAIL  DATABASE_URL is not set. Add it to server/.env');
    process.exit(1);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error('FAIL  DATABASE_URL is not a valid URI.');
    console.error('      Expected postgresql://user:password@host:port/dbname');
    console.error('      If the password contains @ : / # ? or %, percent-encode it.');
    process.exit(1);
  }

  const target: Target = {
    url,
    host: parsed.hostname,
    port: parsed.port || '5432',
    dbname: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    user: decodeURIComponent(parsed.username),
    hasPassword: Boolean(parsed.password),
  };

  if (PROTECTED.includes(target.dbname)) {
    printTarget(target);
    console.error(`REFUSED  "${target.dbname}" belongs to another project. Not connecting.`);
    console.error(`         This project may only use "${EXPECTED}".`);
    process.exit(2);
  }

  if (target.dbname !== EXPECTED) {
    printTarget(target);
    console.error(`REFUSED  dbname "${target.dbname}" is not the expected "${EXPECTED}".`);
    console.error('         Not connecting. Set EXPECTED_DB if this is intentional.');
    process.exit(3);
  }

  return target;
}

export function printTarget(t: Target): void {
  console.log('target (parsed from server/.env):');
  console.log(`  host      ${t.host}`);
  console.log(`  port      ${t.port}`);
  console.log(`  dbname    ${t.dbname}`);
  console.log(`  user      ${t.user}`);
  console.log(`  password  ${t.hasPassword ? 'set' : 'MISSING'}`);
  console.log('');
}
