-- 015_fm_mod.sql — replace NM (No Mod) with FM (Free Mods) in site_settings.
--
-- FM means any combination of mods is allowed. A player using HD, HR, NM, or any
-- other combination passes mod compliance when the round's requirement is FM.
--
-- repo/challengeScores.ts qualifies() and repo/dzpp.ts scoreRound() both treat
-- 'FM' as "always passes mod check", so this is not only a data change.
--
-- The seed in 011_site_settings.sql is also updated to match, so fresh installs
-- start with FM rather than NM.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

UPDATE site_settings
   SET allowed_mods = array_replace(allowed_mods, 'NM', 'FM')
 WHERE id = 1
   AND 'NM' = ANY(allowed_mods);

COMMENT ON COLUMN site_settings.allowed_mods IS
  'Mod requirements available for submission. FM = Free Mods (any combination allowed). '
  'Other values are specific mod acronyms that must all be present in the play.';
