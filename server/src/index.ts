import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { env } from './env.js';
import authRouter from './routes/auth.js';
import roundsRouter from './routes/rounds.js';
import submissionsRouter from './routes/submissions.js';
import votesRouter from './routes/votes.js';
import adminRouter from './routes/admin.js';
import challengeRouter from './routes/challenge.js';
import rankingsRouter from './routes/rankings.js';
import searchRouter from './routes/search.js';
import favoritesRouter from './routes/favorites.js';
import settingsRouter from './routes/settings.js';
import commentsRouter from './routes/comments.js';

const app = express();
// Render assigns the port to bind via PORT and marks the service failed if
// nothing binds it within the health-check timeout. API_PORT is kept as the
// local-dev override; never set both in production.
const PORT = parseInt(process.env.PORT ?? process.env.API_PORT ?? '3001', 10);
const isProduction = process.env.NODE_ENV === 'production';

// Repo layout: <root>/dist (client build) and <root>/server/dist/index.js (this
// file, compiled). So from dist/index.js, the client build is ../../dist.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, '../../dist');

// One origin, with credentials. env.ts validates it and refuses to boot in production
// without it, rather than silently allowing localhost on a deployed host.
app.use(cors({ origin: env.clientOrigin, credentials: true }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/rounds', roundsRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/votes', votesRouter);
app.use('/api/challenge', challengeRouter);
app.use('/api/rankings', rankingsRouter);
app.use('/api/search', searchRouter);
app.use('/api/favorites', favoritesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/admin', adminRouter);

// ── Static client (production only) ─────────────────────────────────────────
//
// In dev, Vite serves the client and proxies /api to this server. In
// production there is no Vite dev server, so this process must serve the
// built client itself. Client and API share one origin on purpose (see
// env.ts / cors above) — that's what lets cookies stay sameSite: 'lax'
// instead of 'none', which would need a CORS+cookie rewrite for no benefit.
if (isProduction) {
  app.use(express.static(clientDistPath));
}

// ── Fallbacks ────────────────────────────────────────────────────────────────
//
// Every route in this server answers { error: string } on failure, and
// src/api/client.ts's send() reads exactly that shape. Without these two the
// contract had holes at both ends: an unknown path fell through to Express's HTML
// 404, and a malformed JSON body was rejected by express.json() before any handler
// ran, so that came back as HTML too. The client then reported "Request failed
// (400)" with no idea why.
//
// /api/* paths that reach here are genuinely unmatched API routes and stay
// JSON 404s. Everything else, in production, is a client-side route (e.g.
// /rankings on a hard refresh) — serve index.html and let the SPA's router
// handle it, rather than 404ing paths the client itself understands.

app.use((req: Request, res: Response) => {
  if (isProduction && !req.path.startsWith('/api/')) {
    res.sendFile(path.join(clientDistPath, 'index.html'));
    return;
  }
  res.status(404).json({ error: `No API route for ${req.method} ${req.path}` });
});

// Four arguments, or Express treats this as ordinary middleware and never calls it.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const { type, status, statusCode } = err as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };

  // express.json() labels its own refusals; everything else here is unexpected.
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON' });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large' });
    return;
  }

  const known = typeof status === 'number' ? status : typeof statusCode === 'number' ? statusCode : 0;
  if (known >= 400 && known < 500) {
    res.status(known).json({ error: 'Request could not be read' });
    return;
  }

  console.error('[api] unhandled error:', err instanceof Error ? err.stack ?? err.message : err);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
});

app.listen(PORT, () => {
  console.log(`osudz API listening on http://localhost:${PORT}`);
});
