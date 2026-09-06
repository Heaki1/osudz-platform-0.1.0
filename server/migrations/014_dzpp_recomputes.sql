-- 014_dzpp_recomputes.sql — the audit trail for recomputing a round's frozen DZPP.
--
-- Phase 7 of the DZPP roadmap, and the escape hatch for the freeze that Phase 3 introduced.
-- Freezing is right: docs/superpowers/specs/2026-09-05-dzpp-design.md and roadmap rule 7 both
-- say a completed challenge keeps the DZPP it awarded, so retuning a constant in month five
-- must not silently rewrite months one to four. That correctness has one cost — sometimes a
-- round genuinely has to be scored again — and this is the only sanctioned way to do it.
--
-- A TABLE RATHER THAN COLUMNS ON rounds, exactly as 009_round_result_corrections.sql argues:
-- the previous value has to stay readable rather than be overwritten in place, and a round can
-- be recomputed more than once, which columns would flatten to only the latest.
--
-- APPEND-ONLY. A row here is never updated or deleted; the whole point of the table is that
-- what a round used to be worth stays legible after it changed.
--
-- ONE ROUND PER ROW, and the endpoint takes one round id. There is deliberately no bulk sweep:
-- a single call that rewrote every historical round would be one fat finger away from
-- reshaping the whole leaderboard, and no audit row can undo that.
--
-- previous_formula_version IS NULLABLE, and that is the round-1 case. A round that ended before
-- the finalization hook existed has no rows and therefore no version, so NULL means "this round
-- had never been scored" — which is a different event from rescoring one that had, and the
-- column is what tells them apart.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

CREATE TABLE dzpp_recomputes (
  id                       serial      PRIMARY KEY,
  round_id                 integer     NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  previous_rows            integer     NOT NULL,
  new_rows                 integer     NOT NULL,
  previous_total           integer     NOT NULL,
  new_total                integer     NOT NULL,
  previous_formula_version integer,
  new_formula_version      integer     NOT NULL,
  reason                   text        NOT NULL,
  recomputed_by            integer     REFERENCES users(id) ON DELETE SET NULL,
  recomputed_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE dzpp_recomputes IS 'routes/admin.ts: one row per deliberate DZPP recompute of one round. Append-only — never updated, never deleted, because it exists so the previous totals stay readable.';
COMMENT ON COLUMN dzpp_recomputes.previous_rows IS 'round_dzpp rows the round held before the recompute. 0 for a round that had never been scored.';
COMMENT ON COLUMN dzpp_recomputes.previous_total IS 'Sum of final_dzpp before the recompute, so the change in a player-facing number is recoverable without diffing two tables.';
COMMENT ON COLUMN dzpp_recomputes.previous_formula_version IS 'NULL when the round had no rows to carry a version — a finalization that never ran, rather than a rescore. That distinction is why this is nullable.';
COMMENT ON COLUMN dzpp_recomputes.reason IS 'Required. The freeze exists so history does not move quietly; an unexplained recompute is the quiet case wearing a timestamp. routes/admin.ts enforces a minimum length, matching the result-correction endpoint.';
COMMENT ON COLUMN dzpp_recomputes.recomputed_by IS 'Which administrator. ON DELETE SET NULL — losing an account must not remove the record that the recompute happened.';

CREATE INDEX dzpp_recomputes_round ON dzpp_recomputes (round_id, recomputed_at);
