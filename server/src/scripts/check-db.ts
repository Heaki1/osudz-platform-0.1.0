// Pre-migration connectivity check.
//
// Reads DATABASE_URL through dotenv and pg — the same path server/src/db.ts uses
// — so a connection string that passes here is one the server can use. The
// protected-database guard lives in ./guard.ts and runs before any connection.
//
//   cd server && pnpm run db:check

import pg from 'pg';
import { resolveTarget, printTarget } from './guard.js';

const target = resolveTarget();
printTarget(target);

const pool = new pg.Pool({ connectionString: target.url, connectionTimeoutMillis: 5000 });

try {
  const { rows } = await pool.query<{ db: string; usr: string; ver: string }>(
    'SELECT current_database() AS db, current_user AS usr, version() AS ver'
  );
  const { rows: counted } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'public'"
  );
  console.log('OK  connected');
  console.log(`  current_database  ${rows[0].db}`);
  console.log(`  current_user      ${rows[0].usr}`);
  console.log(`  server            ${rows[0].ver.split(',')[0]}`);
  console.log(`  public tables     ${counted[0].n}`);
} catch (err) {
  console.error('FAIL  could not connect, or the query failed.');
  console.error(`      ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 4;
} finally {
  await pool.end();
}
