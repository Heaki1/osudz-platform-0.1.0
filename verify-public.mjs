// The unauthenticated half of the API contract, as a script rather than a scratch file.
//
// Everything checkable WITHOUT a session cookie: which reads are public, which routes
// refuse an anonymous caller, and whether the JSON error shape holds when a request is
// malformed. Its counterpart is verify-authenticated.mjs, which needs a cookie and covers
// what only a signed-in — and admin — caller can reach.
//
//   node verify-public.mjs [baseUrl]     default http://localhost:3001/api
//
// Read-only by construction: every write it sends is expected to be refused, so a run
// cannot change anything even against a live instance.

const BASE = (process.argv[2] ?? 'http://localhost:3001/api').replace(/\/$/, '');

let pass = 0;
let fail = 0;

function ok(what, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ok    ${what}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, init = {}) {
  const headers = init.body ? { 'content-type': 'application/json' } : {};
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual', headers, ...init });
    const text = await res.text();
    let body = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body, contentType: res.headers.get('content-type') ?? '' };
  } catch (err) {
    return { status: 0, body: String(err), contentType: '' };
  }
}

/** A refusal is only correct if it also carries the { error } shape the client parses. */
const refuses = (r, status) =>
  r.status === status && r.body !== null && typeof r.body === 'object' && typeof r.body.error === 'string';

console.log(`\nosu!dz — unauthenticated API sweep against ${BASE}\n`);

const reachable = await call('/rounds/current');
if (reachable.status === 0) {
  console.error(`FAIL  no API at ${BASE}. Start it with: cd server && pnpm run dev`);
  process.exit(1);
}

console.log('--- public reads answer 200, because reading is for everybody ---');
{
  const round = await call('/rounds/current');
  ok('GET /rounds/current answers 200', round.status === 200, `got ${round.status}`);
  const open = round.body;
  if (open) {
    console.log(
      `      round ${open.roundNumber} (id ${open.id}) phase=${open.phase} winnerStatus=${open.winnerStatus}`
    );
  } else {
    console.log('      no round is open — the between-rounds path is what gets exercised');
  }

  const archive = await call('/rounds');
  ok('GET /rounds returns an array', archive.status === 200 && Array.isArray(archive.body), `got ${archive.status}`);

  const subs = await call('/submissions');
  ok('GET /submissions returns an array', subs.status === 200 && Array.isArray(subs.body), `got ${subs.status}`);
  ok(
    'every listed submission is approved — pending entries are not public',
    Array.isArray(subs.body) && subs.body.every((s) => s.reviewStatus === 'approved'),
    JSON.stringify((subs.body ?? []).map((s) => s.reviewStatus))
  );

  const scores = await call('/challenge/scores');
  ok('GET /challenge/scores returns an array', scores.status === 200 && Array.isArray(scores.body), `got ${scores.status}`);

  const settings = await call('/settings');
  ok('GET /settings answers 200', settings.status === 200, `got ${settings.status}`);
  ok(
    'GET /settings exposes the rules and nothing about who set them',
    settings.body !== null &&
      typeof settings.body === 'object' &&
      'allowedStatuses' in settings.body &&
      'allowedMods' in settings.body &&
      !('updatedBy' in settings.body) &&
      !('updatedAt' in settings.body),
    JSON.stringify(settings.body)
  );

  const me = await call('/auth/me');
  ok('GET /auth/me answers 200 with null when signed out', me.status === 200 && me.body === null, `got ${me.status}: ${JSON.stringify(me.body)}`);

  const login = await call('/auth/login');
  ok('GET /auth/login redirects to osu!', login.status === 302, `got ${login.status}`);

  // B8. Public because a discussion nobody can read until they log in is not a discussion.
  // 200 with an array is also the proof migration 012 is applied — before it, a 503.
  const comments = await call(`/comments?roundId=${open?.id ?? 1}`);
  ok(
    'GET /comments?roundId= returns an array, so the comments table is live',
    comments.status === 200 && Array.isArray(comments.body),
    `got ${comments.status}: ${JSON.stringify(comments.body)}`
  );
  if (Array.isArray(comments.body)) {
    console.log(`      ${comments.body.length} comment(s) on record for that round`);
  }
}

console.log('\n--- the JSON error contract holds when a request is malformed ---');
{
  const unknown = await call('/no-such-route');
  ok('an unknown path answers 404 with { error }', refuses(unknown, 404), `got ${unknown.status}: ${JSON.stringify(unknown.body)}`);
  ok('and it is JSON, not an Express HTML page', unknown.contentType.includes('application/json'), unknown.contentType);

  const badRoundId = await call('/rounds/not-a-number');
  ok('GET /rounds/:id rejects a non-numeric id with 400', refuses(badRoundId, 400), `got ${badRoundId.status}: ${JSON.stringify(badRoundId.body)}`);

  const badSubId = await call('/submissions/not-a-number');
  ok('GET /submissions/:id rejects a non-numeric id with 400', refuses(badSubId, 400), `got ${badSubId.status}`);

  const badComments = await call('/comments?roundId=abc');
  ok('GET /comments rejects a non-numeric roundId with 400', refuses(badComments, 400), `got ${badComments.status}`);

  // No selector is not an error: it means "the discussion on the open round", and an empty
  // array when no round is open. Checked against the explicit form so the default cannot drift.
  const noSelector = await call('/comments');
  const explicit = await call(`/comments?roundId=${(await call('/rounds/current')).body?.id ?? 0}`);
  ok(
    'GET /comments with no selector defaults to the open round',
    noSelector.status === 200 &&
      Array.isArray(noSelector.body) &&
      JSON.stringify(noSelector.body) === JSON.stringify(explicit.body ?? []),
    `got ${noSelector.status}: ${JSON.stringify(noSelector.body)} vs ${JSON.stringify(explicit.body)}`
  );

  const badSubmissionId = await call('/comments?submissionId=abc');
  ok('GET /comments rejects a non-numeric submissionId with 400', refuses(badSubmissionId, 400), `got ${badSubmissionId.status}`);

  const missingRound = await call('/rounds/99999999');
  ok('GET /rounds/:id answers 404 for a round that does not exist', refuses(missingRound, 404), `got ${missingRound.status}`);

  const missingSub = await call('/submissions/99999999');
  ok('GET /submissions/:id answers 404 for one that does not exist', refuses(missingSub, 404), `got ${missingSub.status}`);

  // A wrong method must not fall through to a handler that expected a different verb.
  const wrongMethod = await call('/rounds/current', { method: 'DELETE' });
  ok('DELETE on a read-only path is refused', wrongMethod.status === 404 || wrongMethod.status === 405, `got ${wrongMethod.status}`);
}

console.log('\n--- every session-gated route refuses an anonymous caller with 401 ---');
{
  // The full list, not a sample: a route added without a guard is exactly the mistake this
  // section exists to catch, so it is enumerated by hand against the route tables.
  const gated = [
    ['GET',    '/submissions/mine'],
    ['DELETE', '/submissions/mine'],
    ['POST',   '/submissions/lookup', { url: 'https://osu.ppy.sh/beatmapsets/1#osu/1' }],
    ['POST',   '/submissions',        { difficultyId: 1, modRequirement: 'NM', challengeRequirement: 'Full Combo' }],
    ['GET',    '/votes/my'],
    ['POST',   '/votes',              { submissionId: 1 }],
    ['DELETE', '/votes'],
    ['GET',    '/challenge/my'],
    ['POST',   '/challenge/scores'],
    ['GET',    '/search/beatmaps?q=test'],
    ['GET',    '/favorites'],
    ['PUT',    '/favorites/1'],
    ['DELETE', '/favorites/1'],
    ['POST',   '/favorites/import'],
    ['POST',   '/comments',           { submissionId: 1, body: 'hello' }],
    ['POST',   '/auth/logout-all'],
  ];

  for (const [method, path, body] of gated) {
    const r = await call(path, { method, body: body ? JSON.stringify(body) : undefined });
    ok(`${method} ${path} answers 401`, refuses(r, 401), `got ${r.status}: ${JSON.stringify(r.body)}`);
  }

  // POST /auth/logout is deliberately NOT gated: clearing a cookie you may not have is a
  // no-op, and answering 401 would strand a browser holding a cookie the server rejects.
  const logout = await call('/auth/logout', { method: 'POST' });
  ok('POST /auth/logout stays open, because clearing a cookie cannot fail', logout.status === 200, `got ${logout.status}`);
}

console.log('\n--- every admin route refuses an anonymous caller before it does anything ---');
{
  const admin = [
    ['PATCH',  '/admin/round/phase',        { phase: 'voting' }],
    ['POST',   '/admin/round/close-voting'],
    ['POST',   '/admin/round/skip-voting'],
    ['POST',   '/admin/round/winner',       { submissionId: 1 }],
    ['GET',    '/admin/round/tiebreak'],
    ['GET',    '/admin/round/corrections'],
    ['POST',   '/admin/round/correction',   { submissionId: 1, reason: 'x' }],
    ['GET',    '/admin/votes'],
    // Phase 7. The gate has to answer before the recompute does anything, because the
    // recompute is the one write that can move a player-facing historical number.
    ['GET',    '/admin/dzpp/recomputes?roundId=1'],
    ['POST',   '/admin/dzpp/recompute',     { roundId: 1, reason: 'an anonymous caller must never reach this' }],
    ['POST',   '/admin/challenge/scores',   { osuId: 1, score: 1 }],
    ['POST',   '/admin/rounds',             { roundNumber: 99 }],
    ['GET',    '/admin/submissions'],
    ['PATCH',  '/admin/submissions/1',      { reviewStatus: 'approved' }],
    ['GET',    '/admin/countries'],
    ['PUT',    '/admin/countries/FR',       { enabled: true }],
    ['DELETE', '/admin/countries/FR'],
    ['GET',    '/admin/users'],
    ['POST',   '/admin/users/1/revoke'],
    ['GET',    '/admin/participants'],
    ['PUT',    '/admin/participants/1',     { canSubmit: false, canVote: false }],
    ['DELETE', '/admin/participants/1'],
    ['GET',    '/admin/settings'],
    ['PUT',    '/admin/settings',           { minStars: 1 }],
    ['GET',    '/admin/config'],
  ];

  for (const [method, path, body] of admin) {
    const r = await call(path, { method, body: body ? JSON.stringify(body) : undefined });
    ok(`${method} ${path} answers 401`, refuses(r, 401), `got ${r.status}: ${JSON.stringify(r.body)}`);
  }
}

console.log('\n--- the gate answers before the work, which is what makes it a gate ---');
{
  // G3's rule: the limiter keys on the ACCOUNT, so it sits behind requireAuth and an
  // anonymous flood can never consume anybody's budget. Twenty-five rapid anonymous calls
  // to the hardest-limited route must therefore all answer 401 and never 429.
  const burst = await Promise.all(
    Array.from({ length: 25 }, () => call('/search/beatmaps?q=x'))
  );
  const statuses = [...new Set(burst.map((r) => r.status))];
  ok(
    'an anonymous burst on a rate-limited route is 401 throughout, never 429',
    statuses.length === 1 && statuses[0] === 401,
    `saw ${statuses.join(', ')}`
  );

  // Same shape, on the route that spends the osu! quota. Nothing reaches the API unpaid.
  const lookups = await Promise.all(
    Array.from({ length: 25 }, () =>
      call('/submissions/lookup', { method: 'POST', body: JSON.stringify({ url: 'x' }) })
    )
  );
  const lookupStatuses = [...new Set(lookups.map((r) => r.status))];
  ok(
    'POST /submissions/lookup never reaches osu! for an anonymous caller',
    lookupStatuses.length === 1 && lookupStatuses[0] === 401,
    `saw ${lookupStatuses.join(', ')}`
  );

  // A signed cookie is the only thing that grants a session, so a forged one must not.
  const forged = await call('/submissions/mine', {
    headers: { cookie: 'osudz_session=4907876.99999999999999.0.deadbeef' },
  });
  ok('a forged session cookie is refused', refuses(forged, 401), `got ${forged.status}: ${JSON.stringify(forged.body)}`);

  const unsigned = await call('/submissions/mine', {
    headers: { cookie: `osudz_session=4907876.${Date.now() + 86400000}.0` },
  });
  ok('an unsigned session cookie is refused', refuses(unsigned, 401), `got ${unsigned.status}`);
}

console.log('--- the DZ Performance Rankings are public, and Algeria-only ---');
{
  const all = await call('/rankings');
  ok('GET /rankings answers 200 with no session', all.status === 200, `got ${all.status}`);

  const page = all.body ?? {};
  ok(
    'GET /rankings answers the paged envelope, not a bare array',
    !Array.isArray(page) && Array.isArray(page.entries) &&
      typeof page.page === 'number' && typeof page.pageSize === 'number' &&
      typeof page.total === 'number' && Array.isArray(page.years),
    JSON.stringify(page).slice(0, 200)
  );
  ok('GET /rankings defaults to the first page', page.page === 1, `got ${page.page}`);
  ok('GET /rankings pages fifty to a page', page.pageSize === 50, `got ${page.pageSize}`);

  // THE RULE OF THE WHOLE FEATURE. The filter runs in the query, so this is the assertion
  // that it is actually there rather than merely intended.
  const entries = Array.isArray(page.entries) ? page.entries : [];
  const foreign = entries.filter((e) => e.country !== 'DZ').map((e) => e.country);
  ok(
    'no row in the ranking is from outside Algeria',
    foreign.length === 0,
    `saw ${[...new Set(foreign)].join(', ')}`
  );

  // Ordering and ranks. A plain sum descending, with ties sharing a rank.
  const descending = entries.every((e, i) => i === 0 || entries[i - 1].dzpp >= e.dzpp);
  ok('the ranking is ordered by DZPP descending', descending);
  const ranksSane = entries.every(
    (e, i) => i === 0 || (entries[i - 1].dzpp === e.dzpp ? e.rank === entries[i - 1].rank : e.rank > entries[i - 1].rank)
  );
  ok('players level on DZPP share a rank, and a lower total never outranks a higher one', ranksSane);
  ok(
    'every row carries the counts the page renders',
    entries.every(
      (e) =>
        typeof e.dzpp === 'number' && typeof e.roundsPlayed === 'number' &&
        typeof e.firstPlaces === 'number' &&
        (e.bestPlacement === null || typeof e.bestPlacement === 'number')
    )
  );

  // A year the community has not run is an empty table, not an error: the selector only
  // offers years that hold points, but a hand-typed URL must still answer.
  const empty = await call('/rankings?year=1999');
  ok('GET /rankings for a year with no rounds answers 200 and an empty table',
    empty.status === 200 && Array.isArray(empty.body?.entries) && empty.body.entries.length === 0,
    `got ${empty.status}`);

  // Past the end of the table. Empty page, real total.
  const far = await call('/rankings?page=9999');
  ok('a page past the end answers 200, empty, and still reports the total',
    far.status === 200 && Array.isArray(far.body?.entries) && far.body.entries.length === 0 &&
      far.body.total === page.total,
    `got ${far.status}, total ${far.body?.total} vs ${page.total}`);

  ok('GET /rankings accepts a four-digit year', (await call('/rankings?year=2026')).status === 200);

  for (const bad of ['abc', '20261', '26', '-2026', '2026.0']) {
    const r = await call(`/rankings?year=${encodeURIComponent(bad)}`);
    ok(`GET /rankings?year=${bad} is refused as 400`, refuses(r, 400), `got ${r.status}`);
  }
  for (const bad of ['abc', '0', '-1', '1.5']) {
    const r = await call(`/rankings?page=${encodeURIComponent(bad)}`);
    ok(`GET /rankings?page=${bad} is refused as 400`, refuses(r, 400), `got ${r.status}`);
  }

  // The player history panel.
  const history = await call('/rankings/1');
  ok('GET /rankings/:userId answers 200 with an array', history.status === 200 && Array.isArray(history.body), `got ${history.status}`);

  // 200 with [] rather than 404, so the endpoint cannot be used to discover which accounts
  // exist — and so "no rounds yet" and "not in this ranking" read the same.
  const unknown = await call('/rankings/99999999');
  ok('an unknown player answers 200 with an empty history, not 404',
    unknown.status === 200 && Array.isArray(unknown.body) && unknown.body.length === 0,
    `got ${unknown.status}`);

  ok('GET /rankings/:userId refuses a non-numeric id', refuses(await call('/rankings/abc'), 400));
  ok('GET /rankings/:userId refuses a bad year', refuses(await call('/rankings/1?year=abc'), 400));

  // Every frozen round carries its whole derivation, so the page can explain a total.
  const rounds = Array.isArray(history.body) ? history.body : [];
  ok(
    'every frozen round carries its full breakdown',
    rounds.every(
      (r) =>
        typeof r.completionPoints === 'number' && typeof r.qualificationPoints === 'number' &&
        typeof r.placementPoints === 'number' && typeof r.fieldSize === 'number' &&
        typeof r.finalDzpp === 'number' && typeof r.qualified === 'boolean' &&
        (r.performanceValue === null || typeof r.performanceValue === 'number') &&
        (r.placement === null || typeof r.placement === 'number')
    ),
    JSON.stringify(rounds[0] ?? null).slice(0, 200)
  );

  // A non-qualifying round earns no placement, and only qualified plays are placed. The two
  // have to agree with each other on every row.
  ok(
    'no unqualified round carries a placement or placement points',
    rounds.every((r) => r.qualified || (r.placement === null && r.placementPoints === 0))
  );

  // Writing is not part of this surface at all.
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await call('/rankings', { method });
    ok(`${method} /rankings is not a route`, refuses(r, 404), `got ${r.status}`);
  }
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nWhat this sweep cannot see: anything behind a session. Run');
  console.log('  node verify-authenticated.mjs "<osudz_session cookie value>"');
}
process.exit(fail === 0 ? 0 : 1);
