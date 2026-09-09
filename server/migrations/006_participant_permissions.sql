-- 006_participant_permissions.sql — per-player submit and vote overrides.
--
-- docs/todo.txt C5: manual administrator controls applied after an investigation, not
-- an automatic punishment system. my_plan.txt:231 and :761-763 let an administrator
-- allow selected players regardless of country, and repo/users.ts records the gap in
-- its own comment.
--
-- BOTH FLAGS ARE NULLABLE ON PURPOSE. NULL means "no override for this capability —
-- the country allowlist decides", true grants it, false refuses it. C5's decision is
-- that submitting and voting are controlled INDEPENDENTLY, so blocking one must
-- assert nothing about the other: NOT NULL DEFAULT false would make every block a
-- double block, and NOT NULL DEFAULT true would silently grant the other capability
-- to a player the country rule refuses. Absent a row entirely, 005 is the whole rule,
-- exactly as today.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

CREATE TABLE participant_permissions (
  user_id    integer     PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  can_submit boolean,
  can_vote   boolean,
  note       text,
  set_by     integer     REFERENCES users(id) ON DELETE SET NULL,
  set_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE participant_permissions IS 'repo/users.ts: overrides allowed_countries per player, per capability. One row per user; ON DELETE CASCADE because an override for a deleted account means nothing.';
COMMENT ON COLUMN participant_permissions.can_submit IS 'NULL = no override, the country rule decides. true = may submit whatever the country rule says. false = refused.';
COMMENT ON COLUMN participant_permissions.can_vote IS 'NULL = no override, the country rule decides. Blocking is forward-only: a vote already cast stays counted, per the vote-permanence decision in docs/todo.txt.';
COMMENT ON COLUMN participant_permissions.note IS 'Why an administrator set this, shown in the admin Eligibility tab. C5 calls these post-investigation controls, so the reason is part of the record rather than an afterthought.';
