-- 009_round_result_corrections.sql — the audit trail for an administrator overriding a
-- recorded result.
--
-- docs/todo.txt D4, and the vote-permanence decision it is the escape hatch for: a
-- validly cast vote is counted permanently, a later voter block is forward-only, and a
-- later submission rejection does not retroactively discount votes. So an explicit,
-- visible correction is THE ONLY WAY a recorded result ever changes. Without this the
-- permanence rule has no remedy for a mistake but editing the database by hand.
--
-- A TABLE RATHER THAN COLUMNS ON rounds. D4 requires the previous value to stay
-- recoverable rather than be overwritten in place, and a round can be corrected more
-- than once — columns would hold only the latest correction and lose the one before it.
--
-- BOTH SUBMISSION REFERENCES ARE NULLABLE with ON DELETE SET NULL. The audit row, its
-- reason and its actor must survive a submission being deleted; NOT NULL together with
-- ON DELETE SET NULL is a pair that fails at delete time instead of at write time.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

CREATE TABLE round_result_corrections (
  id                     serial      PRIMARY KEY,
  round_id               integer     NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  previous_submission_id integer     REFERENCES submissions(id) ON DELETE SET NULL,
  new_submission_id      integer     REFERENCES submissions(id) ON DELETE SET NULL,
  previous_winner_status text        NOT NULL,
  reason                 text        NOT NULL,
  corrected_by           integer     REFERENCES users(id) ON DELETE SET NULL,
  corrected_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE round_result_corrections IS 'routes/admin.ts: one row per explicit result correction (docs/todo.txt D4). Append-only — a correction row is never updated or deleted, because the whole point of the table is that the previous value stays readable.';
COMMENT ON COLUMN round_result_corrections.previous_submission_id IS 'rounds.winning_submission_id as it stood before this correction. NULL when the round had no recorded winner, which is legal — an administrator can end a round from any phase.';
COMMENT ON COLUMN round_result_corrections.previous_winner_status IS 'rounds.winner_status before the correction, so a correction applied to a pending winner is distinguishable from one applied to an official one.';
COMMENT ON COLUMN round_result_corrections.reason IS 'Required. D4 exists so that a correction is explicit and visible rather than a silent UPDATE, and an unexplained correction is the silent case wearing a timestamp.';

CREATE INDEX round_result_corrections_round ON round_result_corrections (round_id, corrected_at);
