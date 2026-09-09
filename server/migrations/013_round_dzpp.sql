-- 013_round_dzpp.sql — frozen DZ Performance Points, one row per player per round.
--
-- Section I of docs/todo.txt, superseded and approved as
-- docs/superpowers/specs/2026-09-05-dzpp-design.md. DZPP is osu!DZ's own ranking currency,
-- earned only by playing the monthly challenges. It is NOT osu! pp: nothing here reads
-- users.global_rank or any profile total, and DELIBERATELY ABSENT still bans that.
--
--   finalDzpp = round(performance + completion + qualification + placement)
--   placement = table[place] x min(1, qualifiedPlayers / 8)
--
-- A SEPARATE TABLE RATHER THAN COLUMNS ON challenge_scores. That table is mutable — the
-- ON CONFLICT DO UPDATE in repo/challengeScores.ts overwrites a player's row on every
-- re-import, and the manual admin path overwrites it too — and a frozen result has to
-- survive that. 009_round_result_corrections.sql is a table for the same reason: a value
-- that must stay readable cannot live where something else writes.
--
-- A PLAYER WITH NO CHALLENGE SCORE GETS NO ROW, not a row of zeroes. No row is the honest
-- representation of not taking part, and it keeps a rounds-played count correct for free.
-- challenge_scores has no review state at all, so the "invalid/rejected submission" case in
-- the roadmap collapses into this one: submissions.status reviews a BEATMAP ENTRY in the
-- submission phase, never a play.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

-- ── The performance value ────────────────────────────────────────────────────
--
-- The pp of the play itself, read from the same osu! score services/osu.ts already fetches
-- for the leaderboard. It was being parsed and discarded until now.
--
-- NULLABLE, AND THAT IS LOAD-BEARING. osu! awards no pp on a Loved beatmap, and
-- site_settings.allowed_statuses permits Loved, so a whole round can legitimately have none.
-- NULL means "osu! reported no pp for this play" and is a different fact from a play worth
-- 0.00pp; the formula reads NULL as contributing nothing rather than as zero earned.
--
-- Stored at import rather than re-fetched when the round closes: a second fetch could
-- return a newer play than the one the leaderboard showed, and the frozen result would then
-- disagree with the standings players actually saw.

ALTER TABLE challenge_scores ADD COLUMN pp numeric(8,2);

COMMENT ON COLUMN challenge_scores.pp IS 'osu! pp for this play, from the score itself and never from the player profile. NULL when osu! reported none — a Loved beatmap, or an unranked mod combination. Distinct from a real 0.00pp play.';

-- ── The finalization latch ───────────────────────────────────────────────────
--
-- What makes finalization idempotent, and the reason duplicate finalization cannot award
-- points twice. repo/dzpp.ts locks the round FOR UPDATE, refuses when this is already set,
-- and stamps it in the same transaction as the rows. One column to read beats counting rows
-- to guess whether a round was already scored.
--
-- It is also the repair handle: a crash between ending a round and scoring it leaves this
-- NULL on an ended round, which is a state the Phase 7 admin recompute can find and fix.

ALTER TABLE rounds ADD COLUMN dzpp_finalized_at timestamptz;

COMMENT ON COLUMN rounds.dzpp_finalized_at IS 'When DZPP was frozen for this round. NULL means it has not been. Set inside the same transaction that writes round_dzpp, so the two can never disagree.';

-- ── The frozen result ────────────────────────────────────────────────────────

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

COMMENT ON TABLE round_dzpp IS 'One frozen DZPP result per player per round, written once when the round reaches phase = ''ended''. Append-only in practice: the only thing that rewrites a row is the deliberate, audited admin recompute.';
COMMENT ON COLUMN round_dzpp.performance_value IS 'challenge_scores.pp as it stood when the round closed. NULL carries the same meaning as it does there.';
COMMENT ON COLUMN round_dzpp.placement_points IS 'Already multiplied by the field factor. numeric(6,3) because every reachable value is a multiple of one eighth, which 3 decimals hold exactly.';
COMMENT ON COLUMN round_dzpp.placement IS 'Position among the QUALIFIED plays, in the round''s own leaderboard order. NULL when the play did not qualify — only qualified players are placed.';
COMMENT ON COLUMN round_dzpp.qualified IS 'Copied from challenge_scores.qualified as stored, never recomputed. 002_challenge_scores.sql keeps that verdict so a past round survives a rule change, and this inherits it.';
COMMENT ON COLUMN round_dzpp.field_size IS 'Qualified players in the round — the field factor''s input, stored so the row explains its own placement award without re-reading the round. All qualified players, whatever their country: the field is the field that played, and the Algeria filter belongs to the ranking read.';
COMMENT ON COLUMN round_dzpp.final_dzpp IS 'The sum, rounded half-up to a whole number. Rounded per round rather than per total, so the rows on a player''s history sum exactly to the total on the leaderboard.';
COMMENT ON COLUMN round_dzpp.formula_version IS 'DZPP_FORMULA_VERSION in repo/dzpp.ts at the time this was frozen. Roadmap rule 7: retuning a constant must not silently rewrite history, so an old row says which rules produced it.';

-- The cumulative ranking is a sum per player across rounds, so user_id leads. The primary
-- key already covers reads by round.
CREATE INDEX round_dzpp_user ON round_dzpp (user_id);
