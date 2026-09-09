// Migration runner.
//
// Applies every unapplied file in server/migrations in filename order, each
// inside its own transaction, and records it in schema_migrations with a
// checksum. The checksum is what catches an already-applied migration being
// edited afterwards — the situation where the files and the database silently
// stop describing the same schema.
//
//   cd server && pnpm run migrate:status   # read-only: what would run
//   cd server && pnpm run migrate          # apply pending migrations

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { resolveTarget, printTarget } from './guard.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const statusOnly = process.argv.includes('--status') || process.argv.includes('--dry-run');

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

const target = resolveTarget();
printTarget(target);

const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
if (files.length === 0) {
  console.error(`FAIL  no .sql files found in ${MIGRATIONS_DIR}`);
  process.exit(5);
}

const pool = new pg.Pool({ connectionString: target.url, connectionTimeoutMillis: 5000 });

try {
  if (!statusOnly) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text        PRIMARY KEY,
        checksum   text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  const { rows: reg } = await pool.query<{ ok: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok"
  );

  const applied = new Map<string, string>();
  if (reg[0].ok) {
    const { rows } = await pool.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations'
    );
    for (const r of rows) applied.set(r.filename, r.checksum);
  }

  const pending: string[] = [];
  const changed: string[] = [];

  for (const file of files) {
    const sum = sha(await readFile(join(MIGRATIONS_DIR, file), 'utf8'));
    const prev = applied.get(file);
    if (prev === undefined) {
      pending.push(file);
      console.log(`  [pending]  ${file}  ${sum}`);
    } else if (prev !== sum) {
      changed.push(file);
      console.log(`  [CHANGED]  ${file}  applied as ${prev}, file is now ${sum}`);
    } else {
      console.log(`  [applied]  ${file}  ${sum}`);
    }
  }
  console.log('');

  if (changed.length > 0) {
    console.error(`FAIL  ${changed.length} already-applied migration(s) were edited after running.`);
    console.error('      The database no longer matches the files. Do not "fix" this by');
    console.error('      re-running — add a new numbered migration instead.');
    process.exitCode = 6;
  } else if (statusOnly) {
    console.log(`${applied.size} applied, ${pending.length} pending. Nothing written (--status).`);
  } else if (pending.length === 0) {
    console.log('Nothing to do — schema is up to date.');
  } else {
    let ok = 0;
    for (const file of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          file,
          sha(sql),
        ]);
        await client.query('COMMIT');
        ok++;
        console.log(`  OK  ${file}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`FAIL  ${file} — rolled back, no partial schema left behind.`);
        console.error(`      ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 7;
        break;
      } finally {
        client.release();
      }
    }
    console.log('');
    console.log(`${ok} of ${pending.length} pending migration(s) applied.`);
  }
} catch (err) {
  console.error('FAIL  migration run aborted.');
  console.error(`      ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 8;
} finally {
  await pool.end();
}
