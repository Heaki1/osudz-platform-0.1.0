// ApiComment -> BeatmapComment, and the ordering the panel expects.
//
// docs/todo.txt B8. BeatmapCard renders a flat list and places a reply directly under the
// comment it answers, so the grouping happens here rather than in the card: the card's markup
// is part of the vote page design B6 settled and is not being reworked for this.

import { ApiComment } from '../api/client';
import { BeatmapComment } from '../types';

/**
 * "just now", "4m", "3h", "2d" — or a date once it stops being useful as an interval.
 *
 * The card shows this as plain text beside a username, so it has to be short. Absolute dates
 * come back for anything over a week, because "23d" is arithmetic the reader should not have
 * to do.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d`;

  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One comment, shaped for the panel. */
export function toBeatmapComment(comment: ApiComment, now?: number): BeatmapComment {
  return {
    id: String(comment.id),
    user: comment.username,
    avatar: comment.avatarUrl,
    time: relativeTime(comment.createdAt, now),
    text: comment.body,
    parentId: comment.parentId !== null ? String(comment.parentId) : undefined,
  };
}

/**
 * A submission's comments, ordered top-level-first with each reply directly under its parent.
 *
 * The panel is a flat list, so the thread structure has to survive as ORDER. A reply whose
 * parent is not in the list is kept at the end rather than dropped: the parent can only be
 * missing if it was deleted, and losing the reply as well would lose what somebody wrote for a
 * reason they never see.
 */
export function threadComments(comments: ApiComment[], now?: number): BeatmapComment[] {
  const byParent = new Map<number, ApiComment[]>();
  const topLevel: ApiComment[] = [];

  for (const comment of comments) {
    if (comment.parentId === null) {
      topLevel.push(comment);
      continue;
    }
    const siblings = byParent.get(comment.parentId);
    if (siblings) siblings.push(comment);
    else byParent.set(comment.parentId, [comment]);
  }

  const out: BeatmapComment[] = [];
  const placed = new Set<number>();

  for (const parent of topLevel) {
    out.push(toBeatmapComment(parent, now));
    placed.add(parent.id);
    for (const reply of byParent.get(parent.id) ?? []) {
      out.push(toBeatmapComment(reply, now));
      placed.add(reply.id);
    }
  }

  // Orphans: a reply to a comment that is gone. Kept, at the end, rather than silently lost.
  for (const comment of comments) {
    if (!placed.has(comment.id)) out.push(toBeatmapComment(comment, now));
  }

  return out;
}

/** Every submission's comments, keyed by submission id and already threaded. */
export function groupBySubmission(comments: ApiComment[], now?: number): Map<number, BeatmapComment[]> {
  const raw = new Map<number, ApiComment[]>();
  for (const comment of comments) {
    const list = raw.get(comment.submissionId);
    if (list) list.push(comment);
    else raw.set(comment.submissionId, [comment]);
  }

  const out = new Map<number, BeatmapComment[]>();
  for (const [submissionId, list] of raw) out.set(submissionId, threadComments(list, now));
  return out;
}
