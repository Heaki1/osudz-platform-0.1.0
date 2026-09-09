-- 016_challenge_chat.sql — Discord-style live chat for the challenge phase.
--
-- Visible only while the round is in the challenge phase (enforced on the read
-- route). Not archived: the table is round-scoped and the archive page never
-- reads it. Administrators can delete any message; ordinary users can only post.
--
-- round_id is denormalised from the round the chat belongs to, so a single
-- indexed read returns the whole conversation without a join.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

CREATE TABLE challenge_chat (
  id         serial      PRIMARY KEY,
  round_id   integer     NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id    integer     NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  body       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenge_chat_body_not_empty CHECK (length(btrim(body)) > 0)
);

COMMENT ON TABLE challenge_chat IS
  'Live chat shown only during the challenge phase. Admin-deletable. Never archived.';

-- Primary read: all messages in a round, oldest first.
CREATE INDEX challenge_chat_round ON challenge_chat (round_id, created_at);
