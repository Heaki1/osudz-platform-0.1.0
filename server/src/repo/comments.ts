// comments table access.
//
// docs/todo.txt B8. my_plan.txt:596 puts discussion on each vote-page entry, and :620-629
// grants commenting to players who cannot vote — so the route is gated on requireAuth rather
// than on either C5 capability. Before this the panel in src/components/BeatmapCard.tsx kept
// its comments in React state, so every one of them vanished on reload.

import { pool } from '../db.js';

export interface CommentRow {
  id: number;
  round_id: number;
  submission_id: number;
  user_id: number;
  parent_id: number | null;
  body: string;
  created_at: Date;
  username: string;
  avatar_url: string | null;
}

const SELECT = `SELECT c.id, c.round_id, c.submission_id, c.user_id, c.parent_id, c.body,
                       c.created_at, u.username, u.avatar_url
                  FROM comments c
                  JOIN users u ON u.id = c.user_id`;

/**
 * One round's whole discussion, oldest first.
 *
 * The vote page reads this ONCE and groups by submission, rather than one request per card:
 * with a dozen entries on screen that would be a dozen round trips to render one page, and
 * the grouping is a client-side detail either way.
 */
export async function listForRound(roundId: number): Promise<CommentRow[]> {
  const { rows } = await pool.query<CommentRow>(
    `${SELECT} WHERE c.round_id = $1 ORDER BY c.created_at ASC, c.id ASC`,
    [roundId]
  );
  return rows;
}

/** One entry's discussion, oldest first. */
export async function listForSubmission(submissionId: number): Promise<CommentRow[]> {
  const { rows } = await pool.query<CommentRow>(
    `${SELECT} WHERE c.submission_id = $1 ORDER BY c.created_at ASC, c.id ASC`,
    [submissionId]
  );
  return rows;
}

/** One comment by id, for reading back what was just written. */
export async function findById(id: number): Promise<CommentRow | null> {
  const { rows } = await pool.query<CommentRow>(`${SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Posts a comment, or a reply to one.
 *
 * round_id comes from the SUBMISSION, never from the caller: it is denormalised, so letting a
 * request assert it would be letting a request file this round's discussion under another
 * round. A parent is checked against the same submission for the same reason — a reply
 * threaded onto a comment from a different entry would render under the wrong card.
 */
export async function create(values: {
  submissionId: number;
  userId: number;
  body: string;
  parentId: number | null;
}): Promise<CommentRow | null> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO comments (round_id, submission_id, user_id, parent_id, body)
     SELECT s.round_id, s.id, $2, $3, $4
       FROM submissions s
      WHERE s.id = $1
        AND ($3::integer IS NULL OR EXISTS (
              SELECT 1 FROM comments p WHERE p.id = $3 AND p.submission_id = s.id
            ))
     RETURNING id`,
    [values.submissionId, values.userId, values.parentId, values.body]
  );

  // No row means the submission does not exist, or the parent is not a comment on it. The
  // INSERT ... SELECT is what makes that one statement rather than three reads and a race.
  const id = rows[0]?.id;
  return id === undefined ? null : findById(id);
}

/** Maps a row to the ApiComment DTO in src/api/client.ts. */
export function toApiComment(row: CommentRow) {
  return {
    id: row.id,
    submissionId: row.submission_id,
    parentId: row.parent_id,
    userId: row.user_id,
    username: row.username,
    avatarUrl: row.avatar_url ?? '',
    body: row.body,
    createdAt: row.created_at.toISOString(),
  };
}
