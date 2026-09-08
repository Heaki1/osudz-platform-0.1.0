-- 011_site_settings.sql — the administrator-configurable submission rules.
--
-- docs/todo.txt C8 and C9, both surfaced by the C7 admin-tab audit rather than being on
-- the roadmap originally. my_plan.txt:430-431 requires submissions to satisfy
-- administrator-defined star and length limits, :749-752 lists allowed statuses among
-- what an administrator configures, and :754-757 asks for mod requirements and challenge
-- types to be creatable and editable. Nothing enforces or stores any of it today: the
-- only rule in the server is the hardcoded SUBMITTABLE_STATUSES in services/osu.ts,
-- ALLOWED_MODS and ALLOWED_CHALLENGE_TYPES are hardcoded in repo/submissions.ts and
-- duplicated by hand in the admin `challenge` tab, and the submit path never looks at
-- stars or length at all. Two tabs promise configuration that does not exist.
--
-- GLOBAL, ONE ROW — decided 2026-09-05. Not per-round: the admin `rules` tab has no round
-- selector, and per-round limits would need a defaults row as well as the per-round rows.
-- id with CHECK (id = 1) is what keeps it a single row.
--
-- SEEDED FROM THE CONSTANTS THAT ARE HARDCODED TODAY, so applying this changes no
-- behaviour at all until the admin tab writes to it. The star and length limits seed as
-- NULL, meaning no limit, which is exactly what the submit path enforces now.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

CREATE TABLE site_settings (
  id                      integer     PRIMARY KEY DEFAULT 1,
  min_stars               numeric(4,2),
  max_stars               numeric(4,2),
  min_length_seconds      integer,
  max_length_seconds      integer,
  allowed_statuses        text[]      NOT NULL,
  allowed_mods            text[]      NOT NULL,
  allowed_challenge_types text[]      NOT NULL,
  updated_by              integer     REFERENCES users(id) ON DELETE SET NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_settings_single_row CHECK (id = 1)
);

COMMENT ON TABLE site_settings IS 'One row, id = 1. The admin `rules` and `challenge` tabs read and write it; routes/submissions.ts enforces it on submit and in the lookup preview so a player is told before they submit rather than after.';
COMMENT ON COLUMN site_settings.min_stars IS 'NULL means no limit, which is what the submit path enforced before C8. Both bounds are inclusive.';
COMMENT ON COLUMN site_settings.max_length_seconds IS 'Seconds, matching submissions.length_seconds. NULL means no limit.';
COMMENT ON COLUMN site_settings.allowed_statuses IS 'Seeded from SUBMITTABLE_STATUSES in services/osu.ts. Widening it beyond ranked/loved/approved also needs a migration for the submissions_map_status_valid CHECK, which would otherwise refuse the row after the lookup allowed it.';
COMMENT ON COLUMN site_settings.allowed_mods IS 'Seeded from ALLOWED_MODS in repo/submissions.ts, the list the admin `challenge` tab currently duplicates by hand (C9).';
COMMENT ON COLUMN site_settings.allowed_challenge_types IS 'Seeded from ALLOWED_CHALLENGE_TYPES in repo/submissions.ts. Note repo/challengeScores.ts judges these by name, so renaming one is not only a settings change (C9).';

INSERT INTO site_settings (
  id, allowed_statuses, allowed_mods, allowed_challenge_types
) VALUES (
  1,
  ARRAY['ranked', 'loved', 'approved'],
  ARRAY['NM', 'HD', 'HR', 'DT', 'EZ', 'FL', 'HDHR', 'HDDT', 'HRDT'],
  ARRAY['Full Combo', 'Top #1 Score', 'Best Accuracy', 'Lowest Miss Count']
);
