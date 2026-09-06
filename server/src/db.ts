import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// In production (Neon), TLS is required. We don't rely on ?sslmode=require
// surviving in the connection string someone copy-pastes into an env var —
// if it gets trimmed, pg would otherwise fail every query with
// "no pg_hba.conf entry". Forcing ssl here makes that impossible regardless
// of what's in the URL. rejectUnauthorized: false matches Neon's setup
// (their cert chain isn't in Node's default trust store in some environments).
const useSsl = process.env.NODE_ENV === 'production';

// Not yet connected — pool is created lazily so the server boots without a DB.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});
