-- 007_favorites.sql — the two favorite sources, one table.
--
-- docs/todo.txt A4 and A5. TWO SOURCES THAT MUST NOT BE CONFLATED: 'dz' is a map
-- favorited on this site, 'osu' is one imported from the player's official osu!
-- profile. The primary key spans source, so an import can never replace or overwrite
-- a community favorite — the A4 decision expressed as a constraint rather than as
-- care in the query layer. src/App.tsx:196 currently mutates React state only, so
-- every heart is lost on reload.
--
-- WHY THE DISPLAY COLUMNS ARE HERE, which goes beyond A4's stated WHAT: the favorites
-- grid renders beatmap cards with cover, title, artist, stars and BPM. Storing only
-- difficulty_id would mean one osu! API call per favorite on every dashboard load,
-- which trips the 20/minute lookup limiter in middleware/rateLimit.ts immediately.
-- submissions already denormalises the same fields for the same reason, so this is
-- the schema's existing convention; the column names mirror it deliberately, because
-- both are filled from OsuBeatmap in services/osu.ts.
--
-- map_status IS DELIBERATELY UNCONSTRAINED, unlike submissions.map_status. A player's
-- osu! favourites legitimately include graveyard, pending and WIP maps, and A5 must
-- be able to import them; the ranked-status rule belongs to the submit path, not to
-- what somebody is allowed to have favorited.
--
-- OPEN FOR A5, and it does not change this shape: osu! favourites come back as
-- beatmapSETS, each with a difficulty list, so A5 must decide which difficulty of a
-- set becomes a row. The table holds either answer.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

CREATE TABLE favorites (
  user_id         integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  difficulty_id   bigint       NOT NULL,
  source          text         NOT NULL,
  beatmapset_id   bigint       NOT NULL,
  title           text         NOT NULL,
  artist          text         NOT NULL,
  mapper          text         NOT NULL,
  difficulty_name text         NOT NULL,
  map_status      text         NOT NULL,
  cover_url       text,
  preview_url     text,
  stars           numeric(4,2) NOT NULL,
  bpm             integer      NOT NULL,
  length_seconds  integer      NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, difficulty_id, source),
  CONSTRAINT favorites_source_valid CHECK (source IN ('dz', 'osu'))
);

COMMENT ON COLUMN favorites.source IS '''dz'' = favorited on this site (A4). ''osu'' = imported from the player''s osu! profile (A5). Part of the primary key so the same map can be present as both without either overwriting the other.';
COMMENT ON COLUMN favorites.map_status IS 'The beatmap''s osu! status, stored as reported and NOT constrained to the submittable set — an imported osu! favourite may be graveyard or pending.';
COMMENT ON COLUMN favorites.length_seconds IS 'Integer seconds, like submissions.length_seconds. The formatted "1:03" string is produced in the query layer.';
