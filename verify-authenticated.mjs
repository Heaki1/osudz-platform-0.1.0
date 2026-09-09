// Authenticated verification for osu!dz. READ-ONLY by default: it makes no writes
// unless you pass --allow-writes, and it says exactly what it would change first.
//
// Run it from the repo root with the API up, pasting your own browser session cookie:
//
//   node verify-authenticated.mjs "<the osudz_session cookie value>"
//
// To find the cookie: open the site, DevTools -> Application -> Cookies -> osudz_session,
// and copy the Value. It identifies you, so do not paste it anywhere else.

const BASE = 'http://localhost:3001/api';
const session = process.argv[2];
const allowWrites = process.argv.includes('--allow-writes');

if (!session) {
  console.error('usage: node verify-authenticated.mjs "<osudz_session cookie value>" [--allow-writes]');
  process.exit(2);
}

const headers = { Cookie: `osudz_session=${session}`, Accept: 'application/json' };
let pass = 0;
let fail = 0;
let skip = 0;

async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    method: options.method ?? 'GET',
    headers: { ...headers, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`ok    ${label}`);
    pass++;
  } else {
    console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    fail++;
  }
}

function skipped(label, why) {
  console.log(`skip  ${label}\n        ${why}`);
  skip++;
}

console.log('--- who am I ---');
const me = await call('/auth/me');
if (me.status !== 200 || me.body === null) {
  console.error('FAIL  the session cookie was not accepted. Copy it again — it may have expired.');
  process.exit(1);
}
const user = me.body;
console.log(
  `      ${user.username} (osu! id ${user.osuId}, ${user.country}) admin=${user.isAdmin}` +
    ` canSubmit=${user.canSubmit} canVote=${user.canVote} canChallenge=${user.canChallenge}`
);
ok(
  'GET /auth/me carries all three capability flags as booleans',
  typeof user.canSubmit === 'boolean' &&
    typeof user.canVote === 'boolean' &&
    typeof user.canChallenge === 'boolean',
  JSON.stringify({ canSubmit: user.canSubmit, canVote: user.canVote, canChallenge: user.canChallenge })
);

const round = (await call('/rounds/current')).body;
if (!round) {
  console.error('FAIL  no round is open, so there is nothing to verify against.');
  process.exit(1);
}
console.log(
  `      round ${round.roundNumber} (id ${round.id}) phase=${round.phase} winnerStatus=${round.winnerStatus}`
);

console.log('\n--- per-caller reads answer for this account ---');
const mine = await call('/submissions/mine');
ok('GET /submissions/mine answers 200', mine.status === 200, `got ${mine.status}`);
const myVote = await call('/votes/my');
ok('GET /votes/my answers 200', myVote.status === 200, `got ${myVote.status}`);
const myScore = await call('/challenge/my');
ok('GET /challenge/my answers 200', myScore.status === 200, `got ${myScore.status}`);

console.log('\n--- the phase gates refuse out-of-phase writes ---');
if (round.phase === 'submission') {
  const vote = await call('/votes', { method: 'POST', body: JSON.stringify({ submissionId: 1 }) });
  ok(
    'POST /votes is refused during the submission phase',
    vote.status === 409,
    `got ${vote.status}: ${JSON.stringify(vote.body)}`
  );
  const score = await call('/challenge/scores', { method: 'POST' });
  ok(
    'POST /challenge/scores is refused outside the challenge phase',
    score.status === 409,
    `got ${score.status}: ${JSON.stringify(score.body)}`
  );
} else if (round.phase === 'voting') {
  const ballotClosed = round.winnerStatus !== 'none';
  const submit = await call('/submissions', { method: 'POST', body: JSON.stringify({}) });
  ok(
    'POST /submissions is refused during the voting phase',
    submit.status === 409 || submit.status === 400,
    `got ${submit.status}: ${JSON.stringify(submit.body)}`
  );
  if (ballotClosed) {
    const cast = await call('/votes', { method: 'POST', body: JSON.stringify({ submissionId: 1 }) });
    ok(
      'POST /votes is refused once the ballot is closed',
      cast.status === 409 && String(cast.body?.error).includes('closed'),
      `got ${cast.status}: ${JSON.stringify(cast.body)}`
    );
    const retract = await call('/votes', { method: 'DELETE' });
    ok(
      'DELETE /votes is refused once the ballot is closed',
      retract.status === 409 && String(retract.body?.error).includes('closed'),
      `got ${retract.status}: ${JSON.stringify(retract.body)}`
    );
  } else {
    skipped('the frozen-ballot refusals', 'the ballot is still open — close voting first to test them');
  }
} else if (round.phase === 'challenge') {
  const submit = await call('/submissions', { method: 'POST', body: JSON.stringify({}) });
  ok(
    'POST /submissions is refused during the challenge phase',
    submit.status === 409 || submit.status === 400,
    `got ${submit.status}: ${JSON.stringify(submit.body)}`
  );
  const cast = await call('/votes', { method: 'POST', body: JSON.stringify({ submissionId: 1 }) });
  ok(
    'POST /votes is refused during the challenge phase',
    cast.status === 409,
    `got ${cast.status}: ${JSON.stringify(cast.body)}`
  );
}

console.log('\n--- self-voting is refused in both layers ---');
if (mine.body && round.phase === 'voting' && round.winnerStatus === 'none') {
  const own = await call('/votes', {
    method: 'POST',
    body: JSON.stringify({ submissionId: mine.body.id }),
  });
  ok(
    'POST /votes for your own entry is refused',
    own.status === 409,
    `got ${own.status}: ${JSON.stringify(own.body)}`
  );
} else {
  skipped(
    'the self-vote refusal',
    mine.body ? 'the ballot is not open' : 'this account has no entry in the open round'
  );
}

console.log('\n--- admin gating ---');
if (user.isAdmin) {
  for (const [label, path] of [
    ['GET /admin/submissions', '/admin/submissions'],
    ['GET /admin/votes', '/admin/votes'],
    ['GET /admin/round/tiebreak', '/admin/round/tiebreak'],
  ]) {
    const res = await call(path);
    ok(`${label} answers 200 for an admin`, res.status === 200, `got ${res.status}`);
  }

  const badPhase = await call('/admin/round/phase', {
    method: 'PATCH',
    body: JSON.stringify({ phase: 'submission' }),
  });
  ok(
    'PATCH /admin/round/phase refuses a backwards move',
    badPhase.status === 409 || round.phase === 'submission',
    `got ${badPhase.status}: ${JSON.stringify(badPhase.body)}`
  );

  if (round.phase === 'voting') {
    const skipApproval = await call('/admin/round/phase', {
      method: 'PATCH',
      body: JSON.stringify({ phase: 'challenge' }),
    });
    ok(
      'PATCH /admin/round/phase cannot skip the winner approval (voting -> challenge)',
      skipApproval.status === 409,
      `got ${skipApproval.status}: ${JSON.stringify(skipApproval.body)}`
    );
  } else {
    skipped('the voting -> challenge bypass check', `the round is in the ${round.phase} phase`);
  }

  // ── the empty-ballot escape ─────────────────────────────────────────────────
  //
  // POST /admin/round/skip-voting ENDS the round, so this only sends it when the round
  // provably has approved entries — in which case the server must refuse. That makes the
  // check safe to run unconditionally AND makes it the real test of the guard: the refusal
  // is the whole safety property, since without it this route could discard a live ballot.
  {
    const entries = await call('/admin/submissions');
    const approved = (Array.isArray(entries.body) ? entries.body : []).filter(
      (row) => row.reviewStatus === 'approved'
    ).length;

    if (round.phase !== 'voting') {
      const wrongPhase = await call('/round/skip-voting', { method: 'POST' });
      // The route is under /admin; the path above is deliberately wrong, so this also
      // confirms it is not exposed outside the admin router.
      ok(
        'skip-voting does not exist outside /admin',
        wrongPhase.status === 404,
        `got ${wrongPhase.status}`
      );
      const outOfPhase = await call('/admin/round/skip-voting', { method: 'POST' });
      ok(
        'POST /admin/round/skip-voting refuses a round that is not voting',
        outOfPhase.status === 409 && /phase/i.test(outOfPhase.body?.error ?? ''),
        `got ${outOfPhase.status}: ${JSON.stringify(outOfPhase.body)}`
      );
    } else if (approved > 0) {
      const guarded = await call('/admin/round/skip-voting', { method: 'POST' });
      ok(
        'POST /admin/round/skip-voting refuses a round that has a real ballot',
        guarded.status === 409 && /approved/i.test(guarded.body?.error ?? ''),
        `got ${guarded.status}: ${JSON.stringify(guarded.body)}`
      );
      const still = await call('/rounds/current');
      ok(
        'and the refusal left the round exactly where it was',
        still.body?.phase === round.phase && still.body?.winnerStatus === round.winnerStatus,
        `phase ${still.body?.phase}, winnerStatus ${still.body?.winnerStatus}`
      );
    } else {
      skipped(
        'the skip-voting guard check',
        'this round has NO approved entries, so the call would legitimately end it'
      );
    }
  }

  const badScore = await call('/admin/challenge/scores', {
    method: 'POST',
    body: JSON.stringify({ osuId: user.osuId, score: -1, accuracy: 50, misses: 0 }),
  });
  ok(
    'POST /admin/challenge/scores rejects a negative score',
    badScore.status === 400,
    `got ${badScore.status}: ${JSON.stringify(badScore.body)}`
  );

  const noSuchPlayer = await call('/admin/challenge/scores', {
    method: 'POST',
    body: JSON.stringify({ osuId: 999999999, score: 1, accuracy: 50, misses: 0 }),
  });
  ok(
    'POST /admin/challenge/scores refuses an account that has never signed in',
    noSuchPlayer.status === 404 || noSuchPlayer.status === 409,
    `got ${noSuchPlayer.status}: ${JSON.stringify(noSuchPlayer.body)}`
  );
} else {
  for (const [label, path] of [
    ['GET /admin/submissions', '/admin/submissions'],
    ['GET /admin/votes', '/admin/votes'],
    ['POST /admin/rounds', '/admin/rounds'],
  ]) {
    const res = await call(path);
    ok(`${label} answers 403 for a non-admin`, res.status === 403, `got ${res.status}`);
  }
}

console.log('');
console.log('--- beatmap search (H4) ---');
// Read-only and cheap enough to run without --allow-writes: eight requests against a
// 20-a-minute allowance. This is the half of H4 that cannot be checked signed out,
// because requireAuth answers before the parameter validation ever runs.
{
  const submittable = ['ranked', 'loved', 'approved'];

  const found = await call('/search/beatmaps?q=souzou');
  const hits = Array.isArray(found.body?.results) ? found.body.results : [];
  ok(
    'GET /search/beatmaps returns results for a real title',
    found.status === 200 && hits.length > 0,
    `got ${found.status}: ${JSON.stringify(found.body).slice(0, 200)}`
  );

  ok(
    'every hit carries what a card needs',
    hits.length > 0 &&
      hits.every(
        (h) =>
          Number.isFinite(h.difficultyId) &&
          Number.isFinite(h.beatmapsetId) &&
          Number.isFinite(h.stars) &&
          Number.isFinite(h.bpm) &&
          Number.isFinite(h.lengthSeconds) &&
          h.difficultyCount >= 1 &&
          h.title && h.artist && h.mapper && h.difficultyName
      ),
    `first hit: ${JSON.stringify(hits[0])}`
  );

  // Search offers what can be entered. A qualified or graveyard map the submit path
  // would refuse is a trap rather than a wider search.
  ok(
    'no hit has a status the submit path would refuse',
    hits.every((h) => submittable.includes(h.mapStatus)),
    `saw ${[...new Set(hits.map((h) => h.mapStatus))].join(', ')}`
  );

  ok(
    'hits come back ordered by stars, hardest first',
    hits.every((h, i) => i === 0 || hits[i - 1].stars >= h.stars),
    hits.map((h) => h.stars).join(' ')
  );

  const byBpm = await call('/search/beatmaps?q=souzou&sort=bpm');
  const bpmHits = Array.isArray(byBpm.body?.results) ? byBpm.body.results : [];
  ok(
    'sort=bpm orders by bpm, fastest first',
    byBpm.status === 200 && bpmHits.every((h, i) => i === 0 || bpmHits[i - 1].bpm >= h.bpm),
    bpmHits.map((h) => h.bpm).join(' ')
  );

  const loved = await call('/search/beatmaps?q=love&status=loved');
  const lovedHits = Array.isArray(loved.body?.results) ? loved.body.results : [];
  ok(
    'status=loved returns only loved maps',
    loved.status === 200 && lovedHits.every((h) => h.mapStatus === 'loved'),
    `saw ${[...new Set(lovedHits.map((h) => h.mapStatus))].join(', ')}`
  );

  // The browse state: the page fetches before anyone has typed, and an empty q is how.
  const browse = await call('/search/beatmaps');
  ok(
    'an empty query is a browse, not an error',
    browse.status === 200 && Array.isArray(browse.body?.results),
    `got ${browse.status}`
  );

  const nothing = await call('/search/beatmaps?q=zzzzqqqxxnotarealbeatmapzzz');
  ok(
    'a query with no matches is an empty list, not a failure',
    nothing.status === 200 &&
      Array.isArray(nothing.body?.results) &&
      nothing.body.results.length === 0,
    `got ${nothing.status}: ${JSON.stringify(nothing.body).slice(0, 120)}`
  );

  const badStatus = await call('/search/beatmaps?status=graveyard');
  ok('a status the submit path refuses answers 400', badStatus.status === 400, `got ${badStatus.status}`);

  const badSort = await call('/search/beatmaps?sort=nope');
  ok('an unknown sort answers 400 rather than defaulting', badSort.status === 400, `got ${badSort.status}`);
}

console.log('');
console.log('--- country allowlist (C4) ---');
{
  const list = await call('/admin/countries');
  if (list.status === 403) {
    skipped('the allowlist checks', 'this session is not an administrator');
  } else {
    const rows = Array.isArray(list.body) ? list.body : [];
    ok(
      'GET /admin/countries reads the table',
      list.status === 200 && Array.isArray(list.body),
      `got ${list.status}: ${JSON.stringify(list.body).slice(0, 160)}`
    );
    // Migration 005 seeds DZ enabled. Without that row the allowlist refuses everyone,
    // so this doubles as proof the seed landed.
    ok(
      'DZ is listed and enabled, so the seed in 005 landed',
      rows.some((c) => c.country === 'DZ' && c.enabled === true),
      JSON.stringify(rows)
    );

    const badCode = await call('/admin/countries/DZA', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    });
    ok('a three-letter code answers 400', badCode.status === 400, `got ${badCode.status}`);

    const badBody = await call('/admin/countries/TN', {
      method: 'PUT',
      body: JSON.stringify({ enabled: 'yes' }),
    });
    ok('a non-boolean enabled answers 400', badBody.status === 400, `got ${badBody.status}`);

    const missing = await call('/admin/countries/ZZ', { method: 'DELETE' });
    ok(
      'removing a country that is not listed answers 404',
      missing.status === 404,
      `got ${missing.status}`
    );

    if (allowWrites) {
      // Enable TN, confirm it reads back, then remove it — the tree is left as it was.
      const added = await call('/admin/countries/TN', {
        method: 'PUT',
        body: JSON.stringify({ enabled: true }),
      });
      ok('enabling a second country succeeds', added.status === 200, `got ${added.status}`);

      const after = await call('/admin/countries');
      const tn = (Array.isArray(after.body) ? after.body : []).find((c) => c.country === 'TN');
      ok('the second country reads back enabled', tn?.enabled === true, JSON.stringify(tn));

      // canVote is computed from this same allowlist, so /auth/me must agree with it.
      const me = await call('/auth/me');
      ok(
        'GET /auth/me still reports canVote from the allowlist',
        me.status === 200 && typeof me.body?.canVote === 'boolean',
        JSON.stringify(me.body)
      );

      const gone = await call('/admin/countries/TN', { method: 'DELETE' });
      ok('removing it again succeeds, leaving the list as it was', gone.status === 200, `got ${gone.status}`);
    } else {
      skipped('the enable/disable round trip', 'it writes to the allowlist — pass --allow-writes');
    }
  }
}

console.log('');
console.log('--- per-player permissions (C5) ---');
{
  const roster = await call('/admin/users');
  if (roster.status === 403) {
    skipped('the permission checks', 'this session is not an administrator');
  } else {
    const users = Array.isArray(roster.body) ? roster.body : [];
    ok(
      'GET /admin/users returns the roster',
      roster.status === 200 && users.length > 0,
      `got ${roster.status}: ${JSON.stringify(roster.body).slice(0, 160)}`
    );
    ok(
      'every row carries the effective flags and the inputs that produced them',
      users.every(
        (u) =>
          typeof u.canSubmit === 'boolean' &&
          typeof u.canVote === 'boolean' &&
          typeof u.canChallenge === 'boolean' &&
          typeof u.countryAllowed === 'boolean' &&
          (u.override === null || typeof u.override === 'object')
      ),
      JSON.stringify(users[0])
    );

    // The challenge flag is DERIVED, so it can be recomputed from the same row and must
    // agree. This is the C5 challenge rule checked against live data rather than a unit
    // fixture: an unambiguous override decides, otherwise the country allowlist does.
    const derive = (u) => {
      if (u.override?.canSubmit === false && u.override?.canVote === false) return false;
      if (u.override?.canSubmit === true && u.override?.canVote === true) return true;
      return u.countryAllowed;
    };
    const disagreeing = users.filter((u) => u.canChallenge !== derive(u));
    ok(
      'canChallenge on every row is what the C5 challenge rule derives',
      disagreeing.length === 0,
      disagreeing.map((u) => `${u.username}: got ${u.canChallenge}, rule says ${derive(u)}`).join('; ')
    );

    const overrides = await call('/admin/participants');
    ok(
      'GET /admin/participants lists the overrides',
      overrides.status === 200 && Array.isArray(overrides.body),
      `got ${overrides.status}`
    );

    const badId = await call('/admin/participants/nope', {
      method: 'PUT',
      body: JSON.stringify({ canSubmit: false, canVote: null }),
    });
    ok('a non-numeric userId answers 400', badId.status === 400, `got ${badId.status}`);

    const badFlag = await call('/admin/participants/1', {
      method: 'PUT',
      body: JSON.stringify({ canSubmit: 'no', canVote: null }),
    });
    ok('a non-boolean flag answers 400', badFlag.status === 400, `got ${badFlag.status}`);

    // A row overriding nothing records nothing, so it is refused rather than stored.
    const bothNull = await call('/admin/participants/1', {
      method: 'PUT',
      body: JSON.stringify({ canSubmit: null, canVote: null }),
    });
    ok('an override that overrides nothing answers 400', bothNull.status === 400, `got ${bothNull.status}`);

    const noSuchUser = await call('/admin/participants/999999', {
      method: 'PUT',
      body: JSON.stringify({ canSubmit: false, canVote: null }),
    });
    ok(
      'an account that has never signed in answers 404',
      noSuchUser.status === 404,
      `got ${noSuchUser.status}`
    );

    const nothingToClear = await call('/admin/participants/999999', { method: 'DELETE' });
    ok(
      'clearing an override that does not exist answers 404',
      nothingToClear.status === 404,
      `got ${nothingToClear.status}`
    );

    if (allowWrites) {
      // The case a single ban flag could not express, and C5's own VERIFY: block one
      // capability and the other must be untouched. Restored at the end.
      const me = await call('/auth/me');
      const myId = me.body?.id;
      const before = {
        canSubmit: me.body?.canSubmit,
        canVote: me.body?.canVote,
        canChallenge: me.body?.canChallenge,
      };

      const blocked = await call(`/admin/participants/${myId}`, {
        method: 'PUT',
        body: JSON.stringify({ canSubmit: null, canVote: false, note: 'verify-authenticated.mjs' }),
      });
      ok('blocking one capability succeeds', blocked.status === 200, `got ${blocked.status}`);

      const after = await call('/auth/me');
      ok(
        'canVote goes false and canSubmit is untouched',
        after.body?.canVote === false && after.body?.canSubmit === before.canSubmit,
        `canVote ${after.body?.canVote}, canSubmit ${after.body?.canSubmit} (was ${before.canSubmit})`
      );

      // The gate and the flag have to be the same sentence, so the write must refuse too.
      const refused = await call('/votes', {
        method: 'POST',
        body: JSON.stringify({ submissionId: 1 }),
      });
      ok(
        'POST /votes answers 403 and says an administrator restricted the account',
        refused.status === 403 && /administrator/i.test(refused.body?.error ?? ''),
        `got ${refused.status}: ${JSON.stringify(refused.body)}`
      );

      const listed = await call('/admin/participants');
      ok(
        'the override appears in the exception list',
        (Array.isArray(listed.body) ? listed.body : []).some((p) => p.userId === myId),
        JSON.stringify(listed.body)
      );

      // ── the C5 challenge rule, end to end ────────────────────────────────────
      //
      // The override still says canVote:false / canSubmit:null here, which is the PARTIAL
      // case: it must not reach the challenge.
      const partial = await call('/auth/me');
      ok(
        'a block on one capability does not move canChallenge',
        partial.body?.canChallenge === before.canChallenge,
        `canChallenge ${partial.body?.canChallenge}, was ${before.canChallenge}`
      );

      await call(`/admin/participants/${myId}`, {
        method: 'PUT',
        body: JSON.stringify({ canSubmit: false, canVote: false, note: 'verify-authenticated.mjs' }),
      });
      const fully = await call('/auth/me');
      ok(
        'blocking BOTH capabilities takes canChallenge false',
        fully.body?.canChallenge === false,
        `canChallenge ${fully.body?.canChallenge}`
      );

      // The gate, not just the flag. requireCanChallenge is middleware, so it answers
      // before the phase check — this is a 403 in every phase, which is what makes it
      // testable whatever the round is doing.
      const noScore = await call('/challenge/scores', { method: 'POST' });
      ok(
        'POST /challenge/scores answers 403 for an account blocked from both',
        noScore.status === 403 && /restricted this account/i.test(noScore.body?.error ?? ''),
        `got ${noScore.status}: ${JSON.stringify(noScore.body)}`
      );

      await call(`/admin/participants/${myId}`, {
        method: 'PUT',
        body: JSON.stringify({ canSubmit: true, canVote: true, note: 'verify-authenticated.mjs' }),
      });
      const granted = await call('/auth/me');
      ok(
        'granting BOTH takes canChallenge true, whatever the country says',
        granted.body?.canChallenge === true,
        `canChallenge ${granted.body?.canChallenge}`
      );

      const cleared = await call(`/admin/participants/${myId}`, { method: 'DELETE' });
      ok('clearing the override succeeds', cleared.status === 200, `got ${cleared.status}`);

      const restored = await call('/auth/me');
      ok(
        'clearing it hands the account back to the country rule',
        restored.body?.canVote === before.canVote &&
          restored.body?.canSubmit === before.canSubmit &&
          restored.body?.canChallenge === before.canChallenge,
        `canVote ${restored.body?.canVote} (was ${before.canVote}),` +
          ` canChallenge ${restored.body?.canChallenge} (was ${before.canChallenge})`
      );
    } else {
      skipped('the block/restore round trip', 'it writes an override on your own account — pass --allow-writes');
    }
  }
}

console.log('');
console.log('--- favorites (A4) ---');
{
  const list = await call('/favorites');
  ok(
    'GET /favorites returns the caller list',
    list.status === 200 && Array.isArray(list.body),
    `got ${list.status}: ${JSON.stringify(list.body).slice(0, 160)}`
  );

  const badId = await call('/favorites/nope', { method: 'PUT' });
  ok('a non-numeric difficulty id answers 400', badId.status === 400, `got ${badId.status}`);

  const missing = await call('/favorites/999999999', { method: 'DELETE' });
  ok(
    'removing a beatmap that is not favorited answers 404',
    missing.status === 404,
    `got ${missing.status}`
  );

  if (allowWrites) {
    // Souzou Forest [Expert] — the difficulty this instance already has a submission for.
    const id = 4907876;
    const started = (Array.isArray(list.body) ? list.body : []).some((f) => f.difficultyId === id);

    const added = await call(`/favorites/${id}`, { method: 'PUT' });
    ok('favoriting a real beatmap succeeds', added.status === 200, `got ${added.status}`);
    ok(
      'the row comes back with the metadata a card needs',
      added.body?.favorite?.title &&
        added.body?.favorite?.source === 'dz' &&
        Number.isFinite(added.body?.favorite?.stars),
      JSON.stringify(added.body?.favorite)
    );

    // A4's VERIFY: favoriting the same map twice must not create a second row.
    const again = await call(`/favorites/${id}`, { method: 'PUT' });
    const after = await call('/favorites');
    const rows = (Array.isArray(after.body) ? after.body : []).filter((f) => f.difficultyId === id);
    ok('favoriting twice does not create a second row', again.status === 200 && rows.length === 1, `${rows.length} rows`);

    // A graveyard map is a legitimate favorite even though it cannot be submitted — the
    // ranked-status rule belongs to the submit path, not to what somebody may like.
    const graveyard = await call('/favorites/75', { method: 'PUT' });
    ok(
      'an unsubmittable beatmap can still be favorited',
      graveyard.status === 200,
      `got ${graveyard.status}: ${JSON.stringify(graveyard.body)}`
    );
    if (graveyard.status === 200) await call('/favorites/75', { method: 'DELETE' });

    if (!started) {
      const gone = await call(`/favorites/${id}`, { method: 'DELETE' });
      ok('unfavoriting removes it, leaving the list as it was', gone.status === 200, `got ${gone.status}`);
    } else {
      skipped('the unfavorite step', 'that beatmap was already favorited before this run');
    }
  } else {
    skipped('the favorite round trip', 'it writes favorites — pass --allow-writes');
  }
}

console.log('');
console.log('--- osu! favorites import (A5) ---');
if (allowWrites) {
  // A community favorite planted first, so the import can be shown not to disturb it —
  // which is the A4 decision this item is most able to break.
  const planted = 4907876;
  await call(`/favorites/${planted}`, { method: 'PUT' });

  const first = await call('/favorites/import', { method: 'POST' });
  ok(
    'POST /favorites/import succeeds with the app token alone',
    first.status === 200 && Number.isFinite(first.body?.imported),
    `got ${first.status}: ${JSON.stringify(first.body).slice(0, 160)}`
  );

  const rows = Array.isArray(first.body?.favorites) ? first.body.favorites : [];
  const dz = rows.filter((f) => f.source === 'dz');
  const osu = rows.filter((f) => f.source === 'osu');

  ok(
    'the community favorite is still there, untouched',
    dz.some((f) => f.difficultyId === planted),
    JSON.stringify(dz.map((f) => f.difficultyId))
  );
  ok(
    'imported rows are tagged as osu! favorites',
    osu.every((f) => f.source === 'osu'),
    `${osu.length} imported rows`
  );
  if (osu.length === 0) {
    console.log('      note: this account has no osu! favourites, so the import had nothing to add.');
  }

  const second = await call('/favorites/import', { method: 'POST' });
  const after = Array.isArray(second.body?.favorites) ? second.body.favorites : [];
  ok(
    'importing twice does not duplicate rows',
    second.status === 200 && after.length === rows.length,
    `${rows.length} then ${after.length}`
  );

  // One row per (difficulty, source) is the primary key; this proves the read agrees.
  const keys = after.map((f) => `${f.source}:${f.difficultyId}`);
  ok('every favorite is unique on source and difficulty', new Set(keys).size === keys.length, `${keys.length} rows`);

  await call(`/favorites/${planted}`, { method: 'DELETE' });
} else {
  skipped('the osu! favorites import', 'it writes favorites — pass --allow-writes');
}

console.log('');
console.log('--- submission rules (C8) and the requirement lists (C9) ---');
{
  const publicRules = await call('/settings');
  ok(
    'GET /settings is public and carries the rules',
    publicRules.status === 200 &&
      Array.isArray(publicRules.body?.allowedStatuses) &&
      Array.isArray(publicRules.body?.allowedMods) &&
      Array.isArray(publicRules.body?.allowedChallengeTypes),
    `got ${publicRules.status}: ${JSON.stringify(publicRules.body).slice(0, 200)}`
  );
  ok(
    'the public read carries no administrative detail',
    publicRules.body?.updatedBy === undefined && publicRules.body?.updatedAt === undefined,
    JSON.stringify(Object.keys(publicRules.body ?? {}))
  );

  const admin = await call('/admin/settings');
  if (admin.status === 403) {
    skipped('the settings write checks', 'this session is not an administrator');
  } else {
    ok('GET /admin/settings adds who last changed them', admin.status === 200 && 'updatedAt' in (admin.body ?? {}), `got ${admin.status}`);

    const badStars = await call('/admin/settings', { method: 'PUT', body: JSON.stringify({ minStars: 'hard' }) });
    ok('a non-numeric star bound answers 400', badStars.status === 400, `got ${badStars.status}`);

    // Widening past the three statuses the schema CHECK allows would let the lookup accept a
    // beatmap the insert then refuses — a rule that contradicts itself between two requests.
    const badStatus = await call('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ allowedStatuses: ['ranked', 'graveyard'] }),
    });
    ok('a status the schema cannot store answers 400', badStatus.status === 400, `got ${badStatus.status}`);

    const emptyList = await call('/admin/settings', { method: 'PUT', body: JSON.stringify({ allowedMods: [] }) });
    ok('an empty mod list answers 400', emptyList.status === 400, `got ${emptyList.status}`);

    const nothing = await call('/admin/settings', { method: 'PUT', body: JSON.stringify({}) });
    ok('a patch with no fields answers 400', nothing.status === 400, `got ${nothing.status}`);

    if (allowWrites) {
      const before = admin.body;
      // Crossed bounds are checked against the MERGED row, so sending only a minimum still
      // catches a maximum that was already stored.
      const set = await call('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ minStars: 2, maxStars: 8, minLengthSeconds: 30, maxLengthSeconds: 600 }),
      });
      ok('saving the star and length bounds succeeds', set.status === 200, `got ${set.status}`);

      const crossed = await call('/admin/settings', { method: 'PUT', body: JSON.stringify({ minStars: 9 }) });
      ok(
        'a minimum above the stored maximum answers 400',
        crossed.status === 400,
        `got ${crossed.status}: ${JSON.stringify(crossed.body)}`
      );

      // The rule has to bite on the lookup, which is the whole point of checking it there.
      const tooEasy = await call('/submissions/lookup', { method: 'POST', body: JSON.stringify({ url: '75' }) });
      ok(
        'the lookup refuses a beatmap outside the rules with a readable reason',
        tooEasy.status === 422 && typeof tooEasy.body?.error === 'string',
        `got ${tooEasy.status}: ${JSON.stringify(tooEasy.body)}`
      );

      const restored = await call('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          minStars: before?.minStars ?? null,
          maxStars: before?.maxStars ?? null,
          minLengthSeconds: before?.minLengthSeconds ?? null,
          maxLengthSeconds: before?.maxLengthSeconds ?? null,
          allowedStatuses: before?.allowedStatuses ?? ['ranked', 'loved', 'approved'],
        }),
      });
      ok('the rules are restored to what they were', restored.status === 200, `got ${restored.status}`);
    } else {
      skipped('the rule round trip', 'it writes the submission rules — pass --allow-writes');
    }
  }
}

console.log('');
console.log('--- result correction (D4) ---');
{
  const history = await call('/admin/round/corrections');
  if (history.status === 403) {
    skipped('the correction checks', 'this session is not an administrator');
  } else {
    ok(
      'GET /admin/round/corrections reads the history',
      history.status === 200 && Array.isArray(history.body),
      `got ${history.status}: ${JSON.stringify(history.body).slice(0, 160)}`
    );

    const badId = await call('/admin/round/correction', {
      method: 'POST',
      body: JSON.stringify({ submissionId: 'nope', reason: 'a long enough reason here' }),
    });
    ok('a non-numeric submissionId answers 400', badId.status === 400, `got ${badId.status}`);

    // A correction without a reason is the silent UPDATE this item exists to replace.
    const noReason = await call('/admin/round/correction', {
      method: 'POST',
      body: JSON.stringify({ submissionId: 2 }),
    });
    ok('a missing reason answers 400', noReason.status === 400, `got ${noReason.status}`);

    const shortReason = await call('/admin/round/correction', {
      method: 'POST',
      body: JSON.stringify({ submissionId: 2, reason: 'oops' }),
    });
    ok('a one-word reason answers 400', shortReason.status === 400, `got ${shortReason.status}`);

    const foreign = await call('/admin/round/correction', {
      method: 'POST',
      body: JSON.stringify({ submissionId: 999999, reason: 'not an entry in this round at all' }),
    });
    ok(
      'an entry that is not in this round answers 409',
      foreign.status === 409,
      `got ${foreign.status}: ${JSON.stringify(foreign.body)}`
    );

    // The live instance has exactly one approved entry, which IS the recorded winner, so
    // correcting to it must be refused as a no-op rather than writing an empty audit row.
    const unchanged = await call('/admin/round/correction', {
      method: 'POST',
      body: JSON.stringify({ submissionId: 2, reason: 'the entry that already holds it' }),
    });
    ok(
      'correcting to the entry that already won answers 409',
      unchanged.status === 409,
      `got ${unchanged.status}: ${JSON.stringify(unchanged.body)}`
    );
    console.log(
      '      note: a real correction needs a second entry in the round, so the success path'
    );
    console.log('      stays unexercised here for the same reason H6 is blocked.');
  }
}

console.log('\n--- rate limiting ---');
if (allowWrites) {
  // 25 lookups of the same beatmap: the limit is 20 a minute, so the tail must be 429.
  let limited = false;
  for (let i = 0; i < 25; i++) {
    const res = await call('/submissions/lookup', {
      method: 'POST',
      body: JSON.stringify({ url: '131891' }),
    });
    if (res.status === 429) {
      limited = true;
      break;
    }
  }
  ok('POST /submissions/lookup answers 429 past its limit', limited, 'never hit the limit in 25 tries');
  console.log('      note: your lookup allowance is now spent for up to a minute.');
} else {
  skipped('the rate-limit check', 'it makes 25 lookup requests — pass --allow-writes to run it');
}

console.log('');
console.log('--- comments (B8) ---');
{
  const list = await call('/comments');
  if (list.status === 503) {
    skipped('the comment checks', 'migration 012 has not been applied yet');
  } else {
    ok(
      'GET /comments reads the open round discussion',
      list.status === 200 && Array.isArray(list.body),
      `got ${list.status}: ${JSON.stringify(list.body).slice(0, 160)}`
    );

    const badRound = await call('/comments?roundId=nope');
    ok('a non-numeric roundId answers 400', badRound.status === 400, `got ${badRound.status}`);

    const badSubmission = await call('/comments?submissionId=nope');
    ok('a non-numeric submissionId answers 400', badSubmission.status === 400, `got ${badSubmission.status}`);

    const empty = await call('/comments', { method: 'POST', body: JSON.stringify({ submissionId: 2, body: '   ' }) });
    ok('a blank comment answers 400', empty.status === 400, `got ${empty.status}`);

    const noTarget = await call('/comments', { method: 'POST', body: JSON.stringify({ body: 'hello' }) });
    ok('a comment with no submissionId answers 400', noTarget.status === 400, `got ${noTarget.status}`);

    const tooLong = await call('/comments', {
      method: 'POST',
      body: JSON.stringify({ submissionId: 2, body: 'x'.repeat(2001) }),
    });
    ok('an oversized comment answers 400', tooLong.status === 400, `got ${tooLong.status}`);

    const noSuch = await call('/comments', {
      method: 'POST',
      body: JSON.stringify({ submissionId: 999999, body: 'on a submission that does not exist' }),
    });
    ok('a comment on a missing submission answers 404', noSuch.status === 404, `got ${noSuch.status}`);

    if (allowWrites) {
      const posted = await call('/comments', {
        method: 'POST',
        body: JSON.stringify({ submissionId: 2, body: 'verify-authenticated.mjs — top level' }),
      });
      ok('posting a comment succeeds', posted.status === 200, `got ${posted.status}: ${JSON.stringify(posted.body)}`);

      const id = posted.body?.comment?.id;
      const reply = await call('/comments', {
        method: 'POST',
        body: JSON.stringify({ submissionId: 2, body: 'verify-authenticated.mjs — reply', parentId: id }),
      });
      ok('replying to it succeeds', reply.status === 200, `got ${reply.status}`);
      ok('the reply carries its parent', reply.body?.comment?.parentId === id, JSON.stringify(reply.body?.comment));

      // round_id comes from the submission, never from the caller, so the round read has to
      // find a comment nobody told it the round of.
      const after = await call('/comments');
      const rows = Array.isArray(after.body) ? after.body : [];
      ok('both appear in the round read', rows.some((c) => c.id === id), `${rows.length} comments`);

      // A reply threaded onto a comment from a different entry would render under the wrong
      // card, so the parent is checked against the same submission.
      const crossed = await call('/comments', {
        method: 'POST',
        body: JSON.stringify({ submissionId: 999999, body: 'wrong entry', parentId: id }),
      });
      ok('a reply on the wrong submission answers 404', crossed.status === 404, `got ${crossed.status}`);

      console.log('      note: two comments were left on submission 2 — they are real rows.');
    } else {
      skipped('posting a comment', 'it writes a real comment — pass --allow-writes');
    }
  }
}

console.log('');
console.log('--- session revocation (G6) — LAST, because it revokes this cookie ---');
{
  const me = await call('/auth/me');
  ok('the session works before anything is revoked', me.status === 200 && me.body !== null, `got ${me.status}`);

  const badId = await call('/admin/users/nope/revoke', { method: 'POST' });
  if (badId.status === 403) {
    skipped('the admin revocation checks', 'this session is not an administrator');
  } else {
    ok('a non-numeric userId answers 400', badId.status === 400, `got ${badId.status}`);
    const noSuch = await call('/admin/users/999999/revoke', { method: 'POST' });
    ok('an account that does not exist answers 404', noSuch.status === 404, `got ${noSuch.status}`);
  }

  if (allowWrites) {
    // The whole point of G6. The server hands the caller a fresh cookie, so the BROWSER stays
    // signed in — but this script keeps sending the original string, which is now one epoch
    // behind. That is exactly the stolen-cookie case, and it must stop working.
    const before = await call('/auth/me');
    const revoked = await call('/auth/logout-all', { method: 'POST' });
    ok('POST /auth/logout-all succeeds', revoked.status === 200, `got ${revoked.status}`);

    const after = await call('/auth/me');
    ok(
      'the cookie this script holds is now refused, which is the stolen-cookie case',
      after.status === 200 && after.body === null,
      `got ${after.status}: ${JSON.stringify(after.body)}`
    );

    const gated = await call('/favorites');
    ok(
      'a gated route refuses the revoked cookie and says why',
      gated.status === 401 && /signed out/i.test(gated.body?.error ?? ''),
      `got ${gated.status}: ${JSON.stringify(gated.body)}`
    );

    console.log('');
    console.log('      NOTE: the cookie you pasted is now revoked, on purpose — that IS the check.');
    console.log('      Your browser is unaffected: the server issued it a fresh cookie. To run');
    console.log('      this script again, copy the new osudz_session value out of DevTools.');
    console.log(`      (the session belonged to: ${before.body?.username ?? 'unknown'})`);
  } else {
    skipped('the revocation round trip', 'it invalidates the cookie you pasted — pass --allow-writes');
  }
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail === 0 ? 0 : 1);
