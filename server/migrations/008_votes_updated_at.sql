-- 008_votes_updated_at.sql — when a vote was last moved.
--
-- docs/todo.txt B9. votes carries created_at only (001_core.sql:94) and changing a
-- vote is an in-place UPDATE through the ON CONFLICT DO UPDATE in repo/votes.ts, so
-- the time a choice moved is unrecoverable. The repo comment says so.
--
-- HALF OF B9's WHY, AND ONLY HALF. This records WHEN a vote moved. It does not record
-- WHAT IT WAS BEFORE — recovering the previous choice needs a history table, which
-- B9's WHAT does not ask for. The remaining half is written up in docs/todo.txt
-- rather than quietly built here.
--
-- DEFAULT now() rather than nullable, so a freshly cast vote reads updated_at =
-- created_at instead of making "never moved" a null every reader has to remember to
-- handle. Existing rows are stamped with the migration time, which is honest: nothing
-- knows when they last moved. The votes table is empty on the live instance anyway.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

ALTER TABLE votes ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN votes.updated_at IS 'Set by the ON CONFLICT DO UPDATE in repo/votes.ts when a voter moves their vote. Equal to created_at until the first move. Records the time only — the previous choice is not kept.';
