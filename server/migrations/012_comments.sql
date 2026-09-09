-- 012_comments.sql — discussion on each vote-page entry.
--
-- docs/todo.txt B8. my_plan.txt:596 puts discussion on each entry of the vote page, and
-- :620-629 grants commenting to players who cannot vote — which is the reason this is gated on
-- requireAuth rather than on either C5 capability. The panel has existed in
-- src/components/BeatmapCard.tsx since the mock: localComments is React state, so every
-- comment vanished on reload and VotePage passed a no-op handler.
--
-- round_id IS DENORMALISED. It is derivable from submission_id, and B8's WHAT lists it anyway:
-- "every comment in this round" is the moderation read, and going through submissions for it
-- would join on every call to answer a question the row already knows. The submission's round
-- never changes, so the two cannot drift.
--
-- parent_id IS SELF-REFERENTIAL, one level in practice: the panel renders a reply directly
-- under the comment it answers rather than a tree. ON DELETE CASCADE, so removing a comment
-- takes its replies with it — a reply to nothing is not a comment, it is a fragment.
--
-- NOT INCLUDED, and flagged rather than assumed: soft deletion or moderation columns. Nothing
-- in the roadmap asks an administrator to hide a comment, and a deleted_at that nothing reads
-- would be a promise the code does not keep. Reopen with the item that needs it.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

CREATE TABLE comments (
  id            serial      PRIMARY KEY,
  round_id      integer     NOT NULL REFERENCES rounds(id)      ON DELETE CASCADE,
  submission_id integer     NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  user_id       integer     NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  parent_id     integer     REFERENCES comments(id) ON DELETE CASCADE,
  body          text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comments_body_not_empty CHECK (length(btrim(body)) > 0)
);

COMMENT ON TABLE comments IS 'routes/comments.ts. Gated on requireAuth, not on a capability: my_plan.txt grants commenting to players who may not vote.';
COMMENT ON COLUMN comments.round_id IS 'Denormalised from the submission, so a round''s whole discussion is one indexed read. A submission never changes round, so it cannot drift.';
COMMENT ON COLUMN comments.parent_id IS 'The comment being replied to, or NULL for a top-level one. ON DELETE CASCADE — a reply to a deleted comment is a fragment, not a comment.';
COMMENT ON CONSTRAINT comments_body_not_empty ON comments IS 'An empty comment is a mis-click, and the route trims before inserting; this is the guarantee rather than the check.';

-- The panel's own read: one submission's discussion, oldest first.
CREATE INDEX comments_submission ON comments (submission_id, created_at);
-- The moderation read: everything in one round.
CREATE INDEX comments_round ON comments (round_id, created_at);
