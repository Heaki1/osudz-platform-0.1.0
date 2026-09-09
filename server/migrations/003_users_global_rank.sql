-- 003_users_global_rank.sql — store the osu! global rank shown in the nav header.
--
-- NavHeader renders "#12,043" beside the username, so the value has to come from
-- somewhere real. It is refreshed on every login rather than polled, which means
-- it can be stale between logins — acceptable for a display-only figure, and the
-- alternative (an osu! API call on every /auth/me) would be far worse.
--
-- Nullable: unranked and inactive accounts have no global_rank.

ALTER TABLE users ADD COLUMN global_rank integer;

COMMENT ON COLUMN users.global_rank IS 'osu! statistics.global_rank at last login. Null when unranked.';
