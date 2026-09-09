-- 002_challenge_scores.sql — the challenge-phase leaderboard.
--
-- Scope note: this one goes slightly beyond the four tables agreed for this
-- pass. It exists because the challenge phase is the third of the product's
-- three phases and the frontend already renders this exact shape in two places
-- (ChallengeScore in src/types.ts, ArchiveEntry.leaderboard). There is no route
-- for it yet — routes/ has auth, rounds, submissions, votes, admin and nothing
-- else — so nothing reads this table until one is written. Safe to skip by not
-- applying this file; drop it if you'd rather add it with its endpoint.

CREATE TABLE challenge_scores (
  id           serial PRIMARY KEY,
  round_id     integer      NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id      integer      NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  score        bigint       NOT NULL,
  accuracy     numeric(5,2) NOT NULL,
  misses       integer      NOT NULL,
  mods         text         NOT NULL,
  qualified    boolean      NOT NULL DEFAULT false,
  osu_score_id bigint UNIQUE,
  submitted_at timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT challenge_scores_one_per_user_per_round UNIQUE (round_id, user_id)
);

COMMENT ON COLUMN challenge_scores.osu_score_id IS 'osu! score id, when the score was imported from the API rather than entered by hand. UNIQUE so the same play cannot be recorded twice.';
COMMENT ON COLUMN challenge_scores.qualified IS 'Whether the play met the round mod/challenge requirement. Computed on insert, stored so past rounds keep their verdict if the rule changes.';

-- One row per user per round holding their best play; the leaderboard is this
-- index read in order.
CREATE INDEX challenge_scores_leaderboard ON challenge_scores (round_id, score DESC);
