-- 004_round_winner.sql — the recorded winner of a round.
--
-- docs/todo.txt D1: when voting ends the server determines the entry with the
-- highest valid vote count and records it as PENDING. It is not official until an
-- administrator approves it, and once official it never moves again. A tie does not
-- resolve itself — it pauses in TIEBREAK until an administrator picks one entry.
--
-- The phase deliberately stays 'voting' through the pending and tiebreak window, so
-- winner_status rather than the phase is what closes the ballot: routes/votes.ts
-- requires winner_status = 'none' for both casting and retracting. Without that a
-- voter could withdraw after the counts below were frozen, and the recorded numbers
-- would stop matching the votes table.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

ALTER TABLE rounds
  ADD COLUMN winner_status         text        NOT NULL DEFAULT 'none',
  ADD COLUMN winning_submission_id integer     REFERENCES submissions(id) ON DELETE SET NULL,
  ADD COLUMN winner_vote_count     integer,
  ADD COLUMN total_votes           integer,
  ADD COLUMN winner_approved_by    integer     REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN winner_approved_at    timestamptz,
  ADD CONSTRAINT rounds_winner_status_valid
    CHECK (winner_status IN ('none', 'pending', 'tiebreak', 'official'));

COMMENT ON COLUMN rounds.winner_status IS 'none while voting runs; pending once closed with one clear leader; tiebreak once closed level; official once an admin approved it. The ballot closes when this leaves ''none''.';
COMMENT ON COLUMN rounds.winning_submission_id IS 'Set when the winner is determined, or on tiebreak resolution. ON DELETE SET NULL rather than CASCADE — losing a submission must not delete the round.';
COMMENT ON COLUMN rounds.winner_vote_count IS 'The winning count, frozen when voting closed. On a tie, the count every tied entry reached.';
COMMENT ON COLUMN rounds.total_votes IS 'Votes cast in the round, frozen when voting closed. Frozen together with winner_vote_count so the pair can never disagree with each other.';

-- Which entries were level at the top, for the window between closing a tied round
-- and an administrator choosing between them. A row per tied entry rather than an
-- array column, so each one is a real foreign key.
CREATE TABLE round_tiebreak_entries (
  round_id      integer NOT NULL REFERENCES rounds(id)      ON DELETE CASCADE,
  submission_id integer NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  PRIMARY KEY (round_id, submission_id)
);

COMMENT ON TABLE round_tiebreak_entries IS 'routes/admin.ts: the candidates an administrator may pick from while rounds.winner_status is ''tiebreak''. Emptied once one is approved.';
