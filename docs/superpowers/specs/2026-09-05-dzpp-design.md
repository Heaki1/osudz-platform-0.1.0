# DZ Performance Points (DZPP) — Design Specification

Status: **APPROVED for v1**, 2026-09-05. Supersedes the proposal in `docs/todo.txt`
section I (items I1–I3), whose accuracy term, star-rating multiplier, winner bonus and
FC bonus are all dropped — osu! pp already prices those, and `DZPP Ranking Roadmap &
Implementation Plan.md` rules 5 and the Winner/FC sections forbid layering a second one.

Authority: `DZPP Ranking Roadmap & Implementation Plan.md` (repository root).
Phase 1 deliverable. Phase 2 onward is implemented against this document.

DZPP is osu!DZ's own ranking currency. It is not osu! pp, and no osu! global rank or
profile pp value is imported. Points are earned only by playing monthly challenges.

---

## 1. Formula

```
finalDzpp = round( performanceValue
                 + completionPoints
                 + qualificationPoints
                 + placementPoints )

placementPoints = basePlacement(placement) x fieldFactor
fieldFactor     = min(1, qualifiedPlayers / 8)
```

Constants live in code, not `site_settings` (approved decision 4 of the earlier pass:
beatmap rules gate submissions before the fact, point weights describe results after it,
and an admin-editable leaderboard weight is a governance hole rather than a feature).

| Constant | Value |
|---|---|
| `DZPP_FORMULA_VERSION` | 1 |
| `COMPLETION_POINTS` | 10 |
| `QUALIFICATION_POINTS` | 25 |
| `PLACEMENT_TABLE` | 1st 50, 2nd 40, 3rd 30, 4th 25, 5th 20, 6th 15, 7th 10, 8th 5, 9th+ 0 |
| `FIELD_FACTOR_TARGET` | 8 |

There is no difficulty multiplier, no accuracy term, no full-combo bonus and no winner
bonus. 1st place is already rewarded through the placement table.

### Field factor

| Qualified players | Factor |
|---:|---:|
| 1 | 0.125 |
| 2 | 0.250 |
| 3 | 0.375 |
| 4 | 0.500 |
| 5 | 0.625 |
| 6 | 0.750 |
| 7 | 0.875 |
| 8+ | 1.000 |

It counts **qualified players**, not submissions, and applies **only** to placement
points. Completion, qualification and performance are untouched. Every reachable value
is a multiple of one eighth, so the arithmetic is exact in binary floating point and
`numeric(6,3)` stores it without loss.

Because placement can never exceed the field size, a fractional factor only ever
multiplies a base of 10 or more; the smallest non-zero placement award is 6.25
(1st of a 1-player field) and 8.75 (7th of a 7-player field).

---

## 2. Component 1 — osu! performance value

**Source.** The `pp` field on the same osu! score `fetchUserScore` already retrieves
(`server/src/services/osu.ts`). Today that function reads total score, accuracy, misses,
mods, rank, passed and ended_at, and **discards `pp`**; `grep -i '\bpp\b|performance'`
over `server/src` currently returns no matches. Phase 3 starts reading it.

It is **not** re-fetched at finalization. A second call could return a newer play than
the one the leaderboard showed, which would make the frozen result disagree with the
visible standings.

**Stored where.** A new nullable `challenge_scores.pp numeric(8,2)`, written at import
time, copied into the frozen `round_dzpp` row at finalization.

**Not profile pp.** `users.global_rank` stays display-only and untouched. A score's own
pp is the play's value, which is what roadmap rule 4 permits and Component 1 asks for.

**When it cannot be obtained** — Loved map, unranked mod combination, or osu! reporting
`null`: store `NULL`, not `0`. "No pp exists for this play" and "a play worth 0.00pp"
are different facts and the breakdown has to be able to say which. It contributes **0**
to the sum. A Loved-map month is therefore scored on completion, qualification and
placement alone, a maximum of 85 points.

**Manual admin scores** (`POST /api/admin/challenge/scores`) accept an optional `pp` and
default to `NULL`.

**Known property, approved (decision 1).** Raw pp is not comparable across rounds. A
7-star month mints roughly 400-600 performance; a 3-star month roughly 40-80. The
DZ-specific terms cap at 85 either way. See section 6 for what that does to the table.

---

## 3. Components 2, 3 and 4

### Completion — +10

Awarded if and only if a `challenge_scores` row exists for (round, user). It cannot
multiply: `challenge_scores_one_per_user_per_round` guarantees one row, and
`round_dzpp`'s primary key guarantees one frozen row.

### Qualification — +25

Reads the **stored** `challenge_scores.qualified` flag. Never recomputed —
`002_challenge_scores.sql` stores it precisely so past rounds keep their verdict when
the rule changes, and that is the precedent this whole feature follows.

**Approved decision 3 — existing semantics kept.** `qualifies()` means the mods matched,
plus `misses === 0` on a `Full Combo` round. On `Top #1 Score`, `Best Accuracy` and
`Lowest Miss Count` rounds every player with the right mods is `qualified`, because
those three are *relative* requirements decided by comparing plays. They are rewarded
through placement, not through qualification. This is existing behaviour and roadmap
rule 1 forbids changing it for the ranking's convenience.

### Placement — table x field factor

Qualified plays only. A player who does not qualify cannot receive placement points.

Ranked using the round's own ordering, which already exists exactly once in the
codebase: `orderFor(challengeRequirement)` in `server/src/repo/challengeScores.ts` —
`score DESC` by default, `accuracy DESC, score DESC` on Best Accuracy, `misses ASC,
score DESC` on Lowest Miss Count — applied by `listForRound` as
`qualified DESC, <orderFor>, submitted_at ASC`.

**The engine does not re-implement that ordering.** Phase 3 reads the round through
`listForRound` and hands the engine plays already in leaderboard order; the engine only
walks them and numbers the qualified ones 1..N. Two implementations of the ordering
would drift, which is the failure `orderFor` and `orderHits` both warn about in their
own comments.

### Ties

None arise. `listForRound` ends `submitted_at ASC`, so every play already has a distinct
position and the DZPP table matches the leaderboard players actually saw. A true tie
would need identical score *and* the requirement's own key, which the trailing
`score DESC` in every ordering makes effectively unreachable.

---

## 4. Score outcome matrix, as it maps onto real states

There is no "rejected challenge score" in this schema. `submissions.status`
(`pending`/`approved`/`rejected`) is the admin review state of a *beatmap entry* in the
submission phase, not of a play. A bad score is corrected by overwriting it through
`POST /api/admin/challenge/scores`, or the row simply is not there. So the input has
exactly two states:

| State | Performance | Completion | Qualification | Placement | DZPP | `round_dzpp` row |
|---|---|---|---|---|---|---|
| No `challenge_scores` row | — | — | — | — | 0 | **none written** |
| Row, `qualified = false` | pp or NULL | +10 | 0 | 0 | round(pp + 10) | yes |
| Row, `qualified = true` | pp or NULL | +10 | +25 | base x factor | round(sum) | yes |

A player with no submission gets no row rather than a zero row. No row is the honest
representation of not having taken part, and it keeps the ranking's `roundsPlayed` count
correct for free.

---

## 5. Worked examples

Three rounds, one thin, one at the field-factor threshold, one large. All figures are
realistic for the star ratings named; pp values are what an osu! play of that quality
returns on a map of that difficulty.

### Round A — 3 qualified. Ranked 5.24 star map, `HD` required, `Lowest Miss Count`

Field factor = 3/8 = **0.375**. Ordering: `misses ASC, score DESC`.

| Player | Play | Qualified | Place | Performance | Compl. | Qual. | Placement | DZPP |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Amine | HD, 0 miss | yes | 1st | 186.42 | 10 | 25 | 50 x 0.375 = 18.750 | **240** |
| Yacine | HD, 0 miss | yes | 2nd | 171.08 | 10 | 25 | 40 x 0.375 = 15.000 | **221** |
| Rania | HD, 1 miss | yes | 3rd | 142.65 | 10 | 25 | 30 x 0.375 = 11.250 | **189** |
| Sofiane | DT, 0 miss | **no** — no HD | — | 268.75 | 10 | 0 | 0 | **279** |
| Nadir | did not play | — | — | — | — | — | — | **0** |

Amine: 186.42 + 10 + 25 + 18.75 = 240.17 → **240**.

Note Sofiane. A strong non-qualifying play out-earns every qualifying one here, because
on a three-player field the entire qualification-plus-placement award is 36.25 and his
mod choice is worth 82 pp more than the winner's. This is the approved magnitude
property, visible at its most extreme.

### Round B — 8 qualified. Ranked 6.13 star map, `HDHR` required, `Full Combo`

Field factor = 8/8 = **1.000** — the table pays in full. Ordering: `score DESC`.

| Player | Play | Qualified | Place | Performance | Compl. | Qual. | Placement | DZPP |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Karim | HDHR, FC | yes | 1st | 331.20 | 10 | 25 | 50 | **416** |
| Amine | HDHR, FC | yes | 2nd | 318.55 | 10 | 25 | 40 | **394** |
| Yacine | HDHR, FC | yes | 4th | 296.10 | 10 | 25 | 25 | **356** |
| Nadir | HDHR, FC | yes | 8th | 271.44 | 10 | 25 | 5 | **311** |
| Sofiane | HDHR, 1 miss | **no** — FC required | — | 289.66 | 10 | 0 | 0 | **300** |
| Rania | did not play | — | — | — | — | — | — | **0** |

Places 3, 5, 6 and 7 are held by four other qualified players, omitted for brevity.

### Round C — 20 qualified. Ranked 4.31 star map, `NM` required, `Best Accuracy`

Field factor = **1.000** (20/8 capped at 1). Ordering: `accuracy DESC, score DESC`.

| Player | Play | Qualified | Place | Performance | Compl. | Qual. | Placement | DZPP |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Amine | NM, 99.41% | yes | 1st | 128.94 | 10 | 25 | 50 | **214** |
| Nadir | NM, 99.12% | yes | 2nd | 124.10 | 10 | 25 | 40 | **199** |
| Yacine | NM, 97.86% | yes | 8th | 112.35 | 10 | 25 | 5 | **152** |
| Karim | NM, 97.70% | yes | 9th | 110.80 | 10 | 25 | 0 | **146** |
| Rania | NM, 97.44% | yes | 10th | 108.22 | 10 | 25 | 0 | **143** |
| Amel | NM, 94.02% | yes | 20th | 88.15 | 10 | 25 | 0 | **123** |
| Sofiane | HD, 98.90% | **no** — mods not NM | — | 121.44 | 10 | 0 | 0 | **131** |

The 8th-to-9th step is 152 → 146: five points of placement table plus 1.55 of pp. The
table runs out gently rather than falling off a cliff.

### Round C-prime — the same 20-player field on a **Loved** map

Identical placements, `pp` NULL for everyone because Loved maps award no osu! pp.

| Place | Performance | Compl. | Qual. | Placement | DZPP |
|---:|---:|---:|---:|---:|---:|
| 1st | NULL → 0 | 10 | 25 | 50 | **85** |
| 2nd | NULL → 0 | 10 | 25 | 40 | **75** |
| 8th | NULL → 0 | 10 | 25 | 5 | **40** |
| 9th | NULL → 0 | 10 | 25 | 0 | **35** |
| 20th | NULL → 0 | 10 | 25 | 0 | **35** |
| not qualified | NULL → 0 | 10 | 0 | 0 | **10** |

---

## 6. Distribution sanity check

Season totals over rounds A, B and C — a plain sum, no decay, no best-N-of-M:

| # | Player | Round A | Round B | Round C | **All-time DZPP** |
|---:|---|---:|---:|---:|---:|
| 1 | Amine | 240 | 394 | 214 | **848** |
| 2 | Yacine | 221 | 356 | 152 | **729** |
| 3 | Sofiane | 279 | 300 | 131 | **710** |
| 4 | Karim | 0 | 416 | 146 | **562** |
| 5 | Nadir | 0 | 311 | 199 | **510** |
| 6 | Rania | 189 | 0 | 143 | **332** |
| 7 | Amel | 0 | 0 | 123 | **123** |

What this says about the design, all of it a consequence of the approved decisions:

1. **pp dominates; the DZ terms decide the top of the table.** Sofiane qualified in not
   one round and finishes 3rd, nineteen points behind Yacine who placed 2nd, 4th and
   8th. On a hard month the 85-point ceiling on completion + qualification + 1st place
   is a tiebreaker between players of similar pp, not a reward that can overcome a
   better play. Approved decision 1, stated plainly.
2. **Turning up every month beats any single result.** Karim posted the season's single
   best round (416) and still finishes 4th, because he missed round A. This is the
   behaviour the roadmap asks for — the ranking rewards sustained participation.
3. **The map moves the table more than placement does.** Round B pays its qualified
   field 311-416; round C pays twenty players 123-214; the same round C field on a Loved
   map would pay 10-85. Which map wins the vote therefore matters more to the standings
   than how a player places on it.
4. **The field factor works.** Winning round A's three-player field is worth 18.75
   placement against 50 for winning round B's eight. A thin early month cannot mint a
   mature month's reward, which is the whole point of the factor.
5. **Nobody can lose DZPP.** Every term is non-negative and a bad month is worth 10
   rather than a penalty, so the all-time table only ever rises. Year tables are what
   let a newcomer compete with an early joiner.

No change is proposed to any constant on the strength of this. Points 1 and 3 are the
two the owner should keep an eye on once real rounds accumulate; if either turns out to
be unwanted in practice the lever is a normalisation of the performance term, which
would be a new decision and a new formula version, not a tweak.

---

## 7. Multiple attempts

Already collapsed by the schema. `challenge_scores_one_per_user_per_round` plus the
`ON CONFLICT (round_id, user_id) DO UPDATE` in `upsert` mean exactly one row exists per
player per round at finalization, and the `round_dzpp` primary key means exactly one
frozen result. Completion points cannot be multiplied by attempts because there is
nothing to multiply.

---

## 8. Rounding

Components are stored at full precision so a breakdown can explain itself.
`final_dzpp` is a **whole integer, rounded half-up** — `Math.round`, which is the
convention already used throughout this codebase: `Math.round(stars * 100) / 100`,
`Math.round(accuracy * 10_000) / 100`, `Math.round(total)`.

Rounding **per round** rather than per total is deliberate. It makes the arithmetic on
the page checkable by a player, because the round rows on their detail panel sum exactly
to the total on the leaderboard. Rounding the sum instead would leave the two disagreeing
by up to half a point per round.

Every term is non-negative, so half-up and half-away-from-zero are the same rule here.

---

## 9. Storage

A separate frozen table, not columns on `challenge_scores`. That table is mutable —
`upsert` overwrites on every re-import and the admin path overwrites too — and frozen
DZPP has to survive that. This follows `round_result_corrections`, which is a table for
the same reason: the value must stay readable rather than be overwritten in place.

```sql
-- server/migrations/013_round_dzpp.sql  (Phase 3)
ALTER TABLE challenge_scores ADD COLUMN pp numeric(8,2);
ALTER TABLE rounds ADD COLUMN dzpp_finalized_at timestamptz;

CREATE TABLE round_dzpp (
  round_id             integer      NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id              integer      NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  performance_value    numeric(8,2),
  completion_points    numeric(6,2) NOT NULL,
  qualification_points numeric(6,2) NOT NULL,
  placement_points     numeric(6,3) NOT NULL,
  placement            integer,
  qualified            boolean      NOT NULL,
  field_size           integer      NOT NULL,
  final_dzpp           integer      NOT NULL,
  formula_version      integer      NOT NULL,
  finalized_at         timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, user_id)
);
CREATE INDEX round_dzpp_user ON round_dzpp (user_id);
```

`performance_value` is nullable: NULL means osu! reported no pp. `placement` is nullable:
NULL means the play did not qualify. `field_size` is the qualified count, stored so the
row explains its own placement award without re-reading the round.

`formula_version` is what keeps roadmap rule 7 honest. A constant tuned in month five
does not silently rewrite months one to four, and a deliberate recompute in Phase 7 writes
a new version with an audit row saying so.

`rounds.dzpp_finalized_at` is the idempotency latch — one column to read, rather than
counting rows to guess whether a round was already scored.

Migration numbering: 001-012 are applied with 0 pending, so this is **013**. Once applied
it can never be edited, because of the checksum lock in
`server/src/scripts/migrate.ts`, so any correction becomes 014.

**No backfill is needed.** The live instance has 0 ended rounds, so nothing has ever been
finalized. The single existing challenge score belongs to round 3, which is still in its
challenge phase and can be re-imported to pick up its pp before the round closes.

---

## 10. Finalization

One function, `finalizeRoundDzpp(roundId)`:

1. Lock the round `FOR UPDATE`.
2. Refuse unless `phase = 'ended'`.
3. Refuse if `dzpp_finalized_at IS NOT NULL`. This is the idempotency guarantee.
4. Read the plays through `listForRound(roundId, challengeRequirement)`.
5. Score them with the pure engine.
6. Insert the `round_dzpp` rows.
7. Stamp `dzpp_finalized_at`.

There are exactly three code paths that write `phase = 'ended'`, and all three call it:

| Path | Where | Can it hold challenge scores? |
|---|---|---|
| The clock | `advanceOnDeadline(id, 'challenge', 'ended')` in `applyDueTransitions`, reached only through `findCurrent()` | yes, and this is the normal case |
| Admin phase change | `setPhase(id, 'ended')` from `PATCH /api/admin/round/phase` | yes from `challenge`, no from `submission` |
| Empty ballot | `skipEmptyVoting` | no, it only ever runs from `voting` |

A round ended from `submission`, or through `skipEmptyVoting`, finalizes to zero rows and
still stamps the latch. That is correct: the round is closed for good and had no
participants to score.

**Approved decision 5 — its own transaction, behind the latch.** A crash between the
phase write and the finalization leaves a round ended but unfinalized. The latch makes
that repairable, by re-calling the finalizer or through the Phase 7 admin recompute. The
alternative is threading a transaction client through three call sites, which buys
atomicity at the price of coupling the phase machinery to the ranking.

---

## 11. Eligibility and ranking periods

**Compute for everyone, filter at read time.** Every player with a challenge score gets a
frozen row whatever their country. Two reasons: `field_size` and `placement` then describe
the field that actually played, which is what the roadmap means by counting qualified
players; and changing the display filter later never requires a recompute.

**Approved decision 4 — the ranking filters `users.country_code = 'DZ'`** through a single
exported `RANKING_COUNTRY` constant, not through `allowed_countries`. The roadmap says
"No other country should appear in the DZPP ranking" in so many words. This reverses the
recommendation recorded as Q1 in `docs/todo.txt`; it is DZ-only either way today, and the
constant is a one-line change if the policy should later follow the allowlist.

**Periods.** All-time is the sum of `final_dzpp` over every finalized round, and is the
default view. A year table is the same query with `WHERE rounds.year = :year` —
`rounds.year` is an existing integer column, which is the aggregation key the roadmap asks
for. Equal totals share a rank, through SQL `RANK()`, as the osu! rankings do.

---

## 12. Ranking API shape (Phase 4)

Public, no session, following the conventions in `server/src/routes/rounds.ts` and the
`{ error: string }` failure shape every route in this server answers with.

```text
GET /api/rankings?year=&page=     ->  { page, pageSize, total, years, entries }
GET /api/rankings/:userId?year=   ->  ApiPlayerDzppRound[]
```

`ApiRankingEntry`: rank, userId, osuId, username, avatarUrl, country, dzpp, roundsPlayed,
firstPlaces, bestPlacement.

`ApiPlayerDzppRound`: roundId, roundNumber, month, year, performanceValue,
completionPoints, qualificationPoints, placementPoints, placement, qualified, fieldSize,
finalDzpp. The breakdown travels with the row, because a table of totals with no visible
derivation is a table people argue with rather than chase.

50 rows to a page. The paginated response is an envelope rather than the bare array the
other reads in this project return, because a bare array cannot carry a total.

`years` was added during Phase 4, one field beyond what this section originally specified.
The year selector Phase 5 designs and Phase 6 builds has to get its options from somewhere,
and deriving them here — `SELECT DISTINCT r.year` over `round_dzpp`, unfiltered by the
requested year — means the selector can never offer a season whose table would be empty. The
alternative was for the frontend to infer the list from the archive, which is a heavier call
and can name years that hold no points.

Ranks come from SQL `RANK() OVER (ORDER BY dzpp DESC)`, computed over the whole filtered set
before `LIMIT`, so a tie spanning a page boundary reads correctly on both pages. Username
orders the rows within a tie, which decides only who is printed first, never who ranks higher.

The player history answers 200 with `[]` for a player who has no counted rounds, whatever the
reason — none finalized yet, outside the ranking's country, or no such account. That matches
what `GET /challenge/scores` does for a round that does not exist, and it keeps the endpoint
from being a way to discover which accounts exist.

---

## 13. Inherited limitations

Recorded rather than fixed. Roadmap rule 1 forbids changing existing challenge, voting,
authentication or phase rules unless the ranking strictly requires it, and none of these
qualify.

1. **`submitted_at` resets on re-import.** `upsert` sets `submitted_at = now()`, so a
   player who re-imports an identical play moves to the back of the tie-break order.
2. **The stored play is the osu! best, not the round best.**
   `GET /beatmaps/{id}/scores/users/{id}` returns the top score by the osu! ordering,
   which on a Best Accuracy round need not be the most accurate play.
3. **`passed` is fetched and discarded.** A failed play can be imported and will earn
   completion points. Gating on it would need a schema change and a change to the
   challenge rules.
4. **Full Combo is approximated by `misses === 0`.** A true FC also requires no dropped
   slider ends, and nothing stores combo or the beatmap max combo.

The one existing rule this feature does change is the challenge score path itself, which
gains a `pp` column and reads one more field from the osu! API. Rule 1 permits it because
Component 1 cannot exist without it.

---

## 14. Approved decisions

Confirmed by the owner on 2026-09-05, for v1:

1. Raw osu! pp, with its across-round magnitude difference accepted.
2. Loved-map rounds score on completion, qualification and placement alone.
3. `qualified` keeps its existing mods-only meaning on the three relative requirements.
4. DZ hardcoded in the ranking filter rather than following `allowed_countries`.
5. Finalization runs in its own transaction behind the `dzpp_finalized_at` latch.
6. No database-backed tests for Phase 3. This repository has none, and
   `vitest.server.config.ts` includes only pure unit tests. Rules stay pure and tested;
   SQL is verified by hand.

---

## 15. Phase plan

| Phase | Deliverable | Files |
|---|---|---|
| 2 | Pure calculation engine | NEW `server/src/repo/dzpp.ts` (pure half only), `server/src/repo/dzpp.test.ts` |
| 3 | Database + challenge integration | NEW `server/migrations/013_round_dzpp.sql`; EDIT `services/osu.ts`, `repo/challengeScores.ts`, `routes/challenge.ts`, `routes/admin.ts`, `repo/rounds.ts`, `repo/dzpp.ts` |
| 4 | Ranking API | NEW `server/src/routes/rankings.ts`; EDIT `server/src/index.ts`, `src/api/client.ts`, `verify-public.mjs` |
| 5 | Figma design handoff | needs a plan key and file key from the owner |
| 6 | Frontend | NEW `src/components/platform/RankingsPage.tsx`; EDIT `src/types.ts`, `NavHeader.tsx`, `src/App.tsx` |
| 7 | Admin recompute and audit | NEW `server/migrations/014_dzpp_recomputes.sql`; EDIT `routes/admin.ts`, `AdminDashboard.tsx` |
| 8 | End-to-end verification | — |
| 9 | Polish | — |

Phase 2 writes only the pure half of `repo/dzpp.ts`: no SQL, no HTTP, no import of
`db.ts`. The module lives in `repo/` because that is where this server already keeps pure
rules beside their table — `refuseSkipVoting` in `repo/rounds.ts`, `checkBeatmapRules` in
`repo/siteSettings.ts`, `qualifies` and `orderFor` in `repo/challengeScores.ts`.

### Commands the owner runs by hand

Phase 3, from `C:\Users\heaki\Desktop\osudzpp\server`:

```text
pnpm run migrate:status    # expect 12 applied, 1 pending
pnpm run migrate           # expect 1 of 1 applied
```
