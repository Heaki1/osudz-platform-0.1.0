// Challenge-phase live chat.
//
// One table, one round at a time. The read is public (the route gates nothing
// on auth for GET). Posting requires a session. Deleting requires admin.
// The archive page never touches this table.

import { pool } from '../db.js';

export interface ChatMessageRow {
  id: number;
  round_id: number;
  user_id: number;
  body: string;
  created_at: Date;
  username: string;
  avatar_url: string | null;
  is_admin: boolean;
}

const SELECT = `
  SELECT m.id, m.round_id, m.user_id, m.body, m.created_at,
         u.username, u.avatar_url, u.is_admin
    FROM challenge_chat m
    JOIN users u ON u.id = m.user_id
`;

/** All messages for a round, oldest first. */
export async function listForRound(roundId: number): Promise<ChatMessageRow[]> {
  const { rows } = await pool.query<ChatMessageRow>(
    `${SELECT} WHERE m.round_id = $1 ORDER BY m.created_at ASC, m.id ASC`,
    [roundId]
  );
  return rows;
}

/** Post a message. Returns the new row, or null if the round does not exist. */
export async function post(values: {
  roundId: number;
  userId: number;
  body: string;
}): Promise<ChatMessageRow | null> {
  const { rows: check } = await pool.query<{ id: number }>(
    'SELECT id FROM rounds WHERE id = $1',
    [values.roundId]
  );
  if (!check[0]) return null;

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO challenge_chat (round_id, user_id, body)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [values.roundId, values.userId, values.body]
  );
  const id = rows[0]?.id;
  if (id === undefined) return null;
  return findById(id);
}

/** Find one message by id. */
export async function findById(id: number): Promise<ChatMessageRow | null> {
  const { rows } = await pool.query<ChatMessageRow>(
    `${SELECT} WHERE m.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/** Delete a message by id. Returns true when a row was removed. */
export async function remove(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM challenge_chat WHERE id = $1',
    [id]
  );
  return (rowCount ?? 0) > 0;
}

/** Maps a row to the ApiChatMessage DTO. */
export function toApiChatMessage(row: ChatMessageRow) {
  return {
    id: row.id,
    roundId: row.round_id,
    userId: row.user_id,
    username: row.username,
    avatarUrl: row.avatar_url ?? '',
    isAdmin: row.is_admin,
    body: row.body,
    createdAt: row.created_at.toISOString(),
  };
}
