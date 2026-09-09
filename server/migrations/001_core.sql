-- 001_core.sql — users, rounds, submissions, votes.
--
-- Columns are snake_case; the API layer maps them to the camelCase DTOs already
-- declared in src/api/client.ts (ApiUser, ApiRound, ApiSubmission). Two
-- deliberate shape differences from those DTOs:
--   * length_seconds is an integer here; ApiSubmission.length is the formatted
--     "1:03" string, produced in the query layer. Storing the display string
--     would make sorting and filtering by length impossible.
--   * vote counts are derived with COUNT(*) against votes, not denormalised onto
--     submissions, so the two can never drift apart.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

-- ── users ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id           serial PRIMARY KEY,
  osu_id       bigint      NOT NULL UNIQUE,
  username     text        NOT NULL,
  country_code char(2)     NOT NULL,
  avatar_url   text,
  is_admin     boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN users.osu_id IS 'osu! account id from GET /api/v2/me — the stable identity, not username.';
COMMENT ON COLUMN users.country_code IS 'ISO 3166-1 alpha-2 from the osu! profile; DZ is what gates voting.';

-- ── rounds ──────────────────────────────────────────────────────────────────
CREATE TABLE rounds (
  id                 serial PRIMARY KEY,
  round_number       integer     NOT NULL UNIQUE,
  phase              text        NOT NULL DEFAULT 'submission',
  month              text        NOT NULL,
  year               integer     NOT NULL,
  reward             text,
  submission_ends_at timestamptz,
  voting_ends_at     timestamptz,
  challenge_ends_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rounds_phase_valid CHECK (phase IN ('submission', 'voting', 'challenge', 'ended'))
);

-- routes/rounds.ts queries "the open round", singular — enforce that there is
-- only ever one. Indexing the expression means two non-ended rounds collide.
CREATE UNIQUE INDEX rounds_single_open ON rounds ((phase <> 'ended')) WHERE phase <> 'ended';

COMMENT ON COLUMN rounds.month IS 'Display month name ("July"), matching ApiRound.month.';
COMMENT ON COLUMN rounds.submission_ends_at IS 'Nullable: the NavHeader countdowns are still hardcoded until these are populated.';

-- ── submissions ─────────────────────────────────────────────────────────────
CREATE TABLE submissions (
  id                    serial PRIMARY KEY,
  round_id              integer      NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id               integer      NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  beatmapset_id         bigint       NOT NULL,
  difficulty_id         bigint       NOT NULL,
  title                 text         NOT NULL,
  artist                text         NOT NULL,
  mapper                text         NOT NULL,
  difficulty_name       text         NOT NULL,
  map_status            text         NOT NULL,
  cover_url             text,
  preview_url           text,
  stars                 numeric(4,2) NOT NULL,
  bpm                   integer      NOT NULL,
  length_seconds        integer      NOT NULL,
  cs                    numeric(3,1),
  ar                    numeric(3,1),
  od                    numeric(3,1),
  hp                    numeric(3,1),
  mod_requirement       text         NOT NULL,
  challenge_requirement text         NOT NULL,
  status                text         NOT NULL DEFAULT 'pending',
  reviewed_by           integer      REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT submissions_status_valid     CHECK (status     IN ('pending', 'approved', 'rejected')),
  CONSTRAINT submissions_map_status_valid CHECK (map_status IN ('ranked', 'loved', 'approved')),
  CONSTRAINT submissions_one_per_user_per_round UNIQUE (round_id, user_id)
);

COMMENT ON COLUMN submissions.map_status IS 'The beatmap''s osu! status (BeatmapStatus). Separate from .status, which is the admin review state.';
COMMENT ON CONSTRAINT submissions_one_per_user_per_round ON submissions IS 'routes/submissions.ts: one submission per user per round.';

CREATE INDEX submissions_round_status ON submissions (round_id, status);

-- ── votes ───────────────────────────────────────────────────────────────────
CREATE TABLE votes (
  id            serial PRIMARY KEY,
  round_id      integer     NOT NULL REFERENCES rounds(id)      ON DELETE CASCADE,
  user_id       integer     NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  submission_id integer     NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT votes_one_per_user_per_round UNIQUE (round_id, user_id)
);

COMMENT ON CONSTRAINT votes_one_per_user_per_round ON votes IS 'routes/votes.ts: one vote per user per round. Changing a vote is an UPDATE, not a second row.';

CREATE INDEX votes_submission ON votes (submission_id);
