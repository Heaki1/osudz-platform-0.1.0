// favorites table access.
//
// docs/todo.txt A4 and A5. TWO SOURCES THAT MUST NOT BE CONFLATED: 'dz' is a map favorited
// on this site, 'osu' is one imported from the player's official osu! profile. The primary
// key spans source, so an import can never overwrite a community favorite — the decision
// expressed as a constraint rather than as care in the query layer.
//
// The display columns are stored rather than looked up. The favorites grid renders beatmap
// cards, and holding only difficulty_id would mean one osu! API call per favorite on every
// dashboard load, which trips the lookup limiter immediately. submissions already
// denormalises the same fields for the same reason.

import { pool } from '../db.js';
import type { OsuBeatmapAnyStatus } from '../services/osu.js';

export const FAVORITE_SOURCES = ['dz', 'osu'] as const;
export type FavoriteSource = (typeof FAVORITE_SOURCES)[number];

export interface FavoriteRow {
  user_id: number;
  difficulty_id: string;
  source: FavoriteSource;
  beatmapset_id: string;
  title: string;
  artist: string;
  mapper: string;
  difficulty_name: string;
  map_status: string;
  cover_url: string | null;
  preview_url: string | null;
  stars: string;
  bpm: number;
  length_seconds: number;
  created_at: Date;
}

const COLUMNS = `user_id, difficulty_id, source, beatmapset_id, title, artist, mapper,
                 difficulty_name, map_status, cover_url, preview_url, stars, bpm,
                 length_seconds, created_at`;

/**
 * One caller's favorites, newest first.
 *
 * Both sources in one list, which is what the A4 decision asks for: one favorites UI,
 * distinguished by source rather than split into two grids.
 */
export async function listForUser(userId: number): Promise<FavoriteRow[]> {
  const { rows } = await pool.query<FavoriteRow>(
    `SELECT ${COLUMNS} FROM favorites WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

/** The difficulty ids this caller has favorited, for marking cards elsewhere in the app. */
export async function favoritedIds(userId: number): Promise<number[]> {
  const { rows } = await pool.query<{ difficulty_id: string }>(
    'SELECT DISTINCT difficulty_id FROM favorites WHERE user_id = $1',
    [userId]
  );
  return rows.map((row) => Number(row.difficulty_id));
}

/**
 * Records a favorite. Idempotent by primary key, so pressing the heart twice or importing
 * twice updates the stored metadata rather than creating a second row — which is what the
 * A4 and A5 VERIFY steps both ask for.
 *
 * The metadata is refreshed on conflict on purpose: a map can be re-ranked, and a favorites
 * grid still showing "graveyard" months later would be stale rather than historical.
 */
export async function put(
  userId: number,
  source: FavoriteSource,
  beatmap: OsuBeatmapAnyStatus
): Promise<FavoriteRow> {
  const { rows } = await pool.query<FavoriteRow>(
    `INSERT INTO favorites (
       user_id, difficulty_id, source, beatmapset_id, title, artist, mapper,
       difficulty_name, map_status, cover_url, preview_url, stars, bpm, length_seconds
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (user_id, difficulty_id, source) DO UPDATE SET
       beatmapset_id   = EXCLUDED.beatmapset_id,
       title           = EXCLUDED.title,
       artist          = EXCLUDED.artist,
       mapper          = EXCLUDED.mapper,
       difficulty_name = EXCLUDED.difficulty_name,
       map_status      = EXCLUDED.map_status,
       cover_url       = EXCLUDED.cover_url,
       preview_url     = EXCLUDED.preview_url,
       stars           = EXCLUDED.stars,
       bpm             = EXCLUDED.bpm,
       length_seconds  = EXCLUDED.length_seconds
     RETURNING ${COLUMNS}`,
    [
      userId,
      beatmap.difficultyId,
      source,
      beatmap.beatmapsetId,
      beatmap.title,
      beatmap.artist,
      beatmap.mapper,
      beatmap.difficultyName,
      beatmap.mapStatus,
      beatmap.coverUrl || null,
      beatmap.previewUrl || null,
      beatmap.stars,
      beatmap.bpm,
      beatmap.lengthSeconds,
    ]
  );
  return rows[0];
}

/**
 * Removes one difficulty from a caller's favorites, ACROSS BOTH SOURCES.
 *
 * The heart means "not in my favorites here", and leaving an imported row behind would
 * leave the map still on the grid after the player unfavorited it. Re-importing brings an
 * osu!-sourced row back, which is correct: the osu! profile is the source of truth for that
 * half, and this site cannot unfavorite anything on osu!.
 */
export async function remove(userId: number, difficultyId: number): Promise<number> {
  const { rowCount } = await pool.query(
    'DELETE FROM favorites WHERE user_id = $1 AND difficulty_id = $2',
    [userId, difficultyId]
  );
  return rowCount ?? 0;
}

/**
 * Maps a row to the ApiFavorite DTO in src/api/client.ts.
 *
 * bigint and numeric come back from node-postgres as strings to avoid silent precision
 * loss, so both are converted explicitly here rather than assumed to be numbers.
 */
export function toApiFavorite(row: FavoriteRow) {
  return {
    difficultyId: Number(row.difficulty_id),
    beatmapsetId: Number(row.beatmapset_id),
    source: row.source,
    title: row.title,
    artist: row.artist,
    mapper: row.mapper,
    difficultyName: row.difficulty_name,
    mapStatus: row.map_status,
    coverUrl: row.cover_url ?? '',
    previewUrl: row.preview_url ?? '',
    stars: Number(row.stars),
    bpm: row.bpm,
    lengthSeconds: row.length_seconds,
    favoritedAt: row.created_at.toISOString(),
  };
}

/**
 * Replaces the caller's whole 'osu' set with what their osu! profile currently holds.
 *
 * A MIRROR, NOT AN APPEND, and only of source 'osu'. That source means "what is on your osu!
 * profile", so a map the player has since unfavourited there has to leave here too, or the
 * grid would accumulate rows nothing will ever clear. Source 'dz' is never touched — the A4
 * decision is that the two sets are never conflated, and the delete is scoped to prove it.
 *
 * One transaction, because a half-applied mirror is a list that is neither the old one nor
 * the new one. The first transaction in this file, so it takes a client with pool.connect
 * the way repo/rounds.ts does.
 */
export async function replaceImported(
  userId: number,
  beatmaps: OsuBeatmapAnyStatus[]
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM favorites WHERE user_id = $1 AND source = 'osu'", [userId]);

    if (beatmaps.length > 0) {
      // One multi-row insert rather than a query per favourite: a player with two hundred
      // favourites would otherwise be two hundred round trips inside one transaction.
      const values: unknown[] = [];
      const rows = beatmaps.map((b, i) => {
        const p = i * 14;
        values.push(
          userId, b.difficultyId, 'osu', b.beatmapsetId, b.title, b.artist, b.mapper,
          b.difficultyName, b.mapStatus, b.coverUrl || null, b.previewUrl || null,
          b.stars, b.bpm, b.lengthSeconds
        );
        return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7},
                 $${p + 8}, $${p + 9}, $${p + 10}, $${p + 11}, $${p + 12}, $${p + 13}, $${p + 14})`;
      });

      await client.query(
        `INSERT INTO favorites (
           user_id, difficulty_id, source, beatmapset_id, title, artist, mapper,
           difficulty_name, map_status, cover_url, preview_url, stars, bpm, length_seconds
         ) VALUES ${rows.join(', ')}
         ON CONFLICT (user_id, difficulty_id, source) DO NOTHING`,
        values
      );
    }

    await client.query('COMMIT');
    return beatmaps.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
