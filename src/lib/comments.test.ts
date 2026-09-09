import { describe, expect, it } from 'vitest';
import { groupBySubmission, relativeTime, threadComments } from './comments';
import type { ApiComment } from '../api/client';

const comment = (over: Partial<ApiComment> = {}): ApiComment => ({
  id: 1,
  submissionId: 2,
  parentId: null,
  userId: 3,
  username: 'Heaki',
  avatarUrl: '',
  body: 'nice map',
  createdAt: '2026-09-05T10:00:00.000Z',
  ...over,
});

const NOW = new Date('2026-09-05T12:00:00.000Z').getTime();

describe('relativeTime', () => {
  it('reads as "just now" inside the first minute', () => {
    expect(relativeTime('2026-09-05T11:59:40.000Z', NOW)).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(relativeTime('2026-09-05T11:30:00.000Z', NOW)).toBe('30m');
    expect(relativeTime('2026-09-05T09:00:00.000Z', NOW)).toBe('3h');
    expect(relativeTime('2026-09-03T12:00:00.000Z', NOW)).toBe('2d');
  });

  // "23d" is arithmetic the reader should not have to do, so it becomes a date.
  it('falls back to a date once an interval stops helping', () => {
    expect(relativeTime('2026-08-01T12:00:00.000Z', NOW)).not.toMatch(/d$/);
  });

  it('is empty rather than "NaN" for an unparseable timestamp', () => {
    expect(relativeTime('not a date', NOW)).toBe('');
  });

  // Clock skew between the browser and the server would otherwise print "-2m".
  it('never reads as negative', () => {
    expect(relativeTime('2026-09-05T12:05:00.000Z', NOW)).toBe('just now');
  });
});

describe('threadComments', () => {
  // The panel is a flat list, so the thread structure has to survive as ORDER: a reply is
  // rendered directly under the comment it answers.
  it('places each reply directly under its parent', () => {
    const ordered = threadComments(
      [
        comment({ id: 1, body: 'first' }),
        comment({ id: 2, body: 'second' }),
        comment({ id: 3, body: 'reply to first', parentId: 1 }),
      ],
      NOW
    );
    expect(ordered.map((c) => c.text)).toEqual(['first', 'reply to first', 'second']);
  });

  it('keeps several replies to one comment in order', () => {
    const ordered = threadComments(
      [
        comment({ id: 1, body: 'top' }),
        comment({ id: 2, body: 'a', parentId: 1 }),
        comment({ id: 3, body: 'b', parentId: 1 }),
      ],
      NOW
    );
    expect(ordered.map((c) => c.text)).toEqual(['top', 'a', 'b']);
  });

  // A parent can only be missing if it was deleted. Dropping the reply too would lose what
  // somebody wrote for a reason they never see.
  it('keeps an orphaned reply at the end rather than dropping it', () => {
    const ordered = threadComments(
      [comment({ id: 1, body: 'top' }), comment({ id: 9, body: 'orphan', parentId: 404 })],
      NOW
    );
    expect(ordered.map((c) => c.text)).toEqual(['top', 'orphan']);
  });

  it('is empty for no comments', () => {
    expect(threadComments([], NOW)).toEqual([]);
  });
});

describe('groupBySubmission', () => {
  it('keys each thread by its submission', () => {
    const grouped = groupBySubmission(
      [
        comment({ id: 1, submissionId: 2, body: 'on two' }),
        comment({ id: 2, submissionId: 7, body: 'on seven' }),
        comment({ id: 3, submissionId: 2, body: 'reply on two', parentId: 1 }),
      ],
      NOW
    );
    expect(grouped.get(2)?.map((c) => c.text)).toEqual(['on two', 'reply on two']);
    expect(grouped.get(7)?.map((c) => c.text)).toEqual(['on seven']);
    expect(grouped.get(99)).toBeUndefined();
  });
});
