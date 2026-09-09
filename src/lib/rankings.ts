// Pure helpers for the DZ Performance Rankings page.
//
// Presentation arithmetic only — no fetching, no React. The page itself owns the reads, and
// everything here is a function of its arguments so it can be tested without a DOM, the same
// way src/lib/round.ts and src/lib/submission.ts are.
//
// NOTHING HERE RE-ORDERS OR RE-FILTERS THE LEADERBOARD. The server decides who appears
// (Algeria only) and in what order (DZPP descending, ties sharing a rank), and it sends the
// rank on every row. A second opinion computed in the client is exactly what would drift.

/** Pages the table needs, given how many players are in it. Never fewer than one. */
export function totalPages(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * The page numbers the pager renders, with runs elided.
 *
 * Up to seven pages every number is shown. Beyond that the control keeps a fixed width: the
 * first page, the current page with a neighbour either side, the last page, and an ellipsis
 * wherever a run was dropped.
 */
export function pageNumbers(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);

  const nums: (number | '…')[] = [1];
  if (page > 3) nums.push('…');
  for (let i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i++) nums.push(i);
  if (page < pages - 2) nums.push('…');
  nums.push(pages);
  return nums;
}

/**
 * The slice of the table the current page holds, for the "Showing x–y of n" label.
 *
 * An empty table is 0–0 rather than 1–0, which reads as a bug rather than as emptiness.
 */
export function showingRange(
  page: number,
  pageSize: number,
  total: number
): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 };
  return { start: (page - 1) * pageSize + 1, end: Math.min(page * pageSize, total) };
}

/** "September 2026" — the round's own month and year, as the history rows read them. */
export const monthLabel = (round: { month: string; year: number }): string =>
  `${round.month} ${round.year}`;

/**
 * A player's mean placement across the rounds they were placed in, to one decimal, or null.
 *
 * ONLY QUALIFIED ROUNDS COUNT, because only they have a placement — a round the player did
 * not qualify in carries null, and averaging that in as a zero would invent a first place.
 * Null when they have never been placed at all, which the tile shows as a dash rather than
 * as "#0".
 *
 * Derived here rather than read from the API on purpose: GET /api/rankings carries no
 * average-placement field, and this is computed from the per-round placements
 * GET /api/rankings/:userId already returns, so it invents no server data.
 */
export function averagePlacement(rounds: readonly { placement: number | null }[]): number | null {
  const placed = rounds.map((round) => round.placement).filter((p): p is number => p !== null);
  if (placed.length === 0) return null;
  return Math.round((placed.reduce((sum, p) => sum + p, 0) / placed.length) * 10) / 10;
}
