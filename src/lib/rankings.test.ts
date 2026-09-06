import { describe, expect, it } from 'vitest';
import { averagePlacement, monthLabel, pageNumbers, showingRange, totalPages } from './rankings';

describe('totalPages', () => {
  it('divides the total by the page size, rounding up', () => {
    expect(totalPages(50, 50)).toBe(1);
    expect(totalPages(51, 50)).toBe(2);
    expect(totalPages(100, 50)).toBe(2);
    expect(totalPages(101, 50)).toBe(3);
  });

  // An empty leaderboard is still one page — the page that says it is empty.
  it('never reports fewer than one page', () => {
    expect(totalPages(0, 50)).toBe(1);
    expect(totalPages(1, 50)).toBe(1);
  });

  // A pageSize of 0 would divide by zero. It cannot come from the API, which sends 50, but
  // the guard keeps the helper total rather than returning Infinity.
  it('survives a page size of zero', () => {
    expect(totalPages(10, 0)).toBe(1);
  });
});

describe('pageNumbers', () => {
  it('lists every page when they all fit', () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  // Beyond seven the run is elided around the current page, so the control keeps a fixed
  // width instead of growing without bound.
  it('elides the run around the first page', () => {
    expect(pageNumbers(1, 10)).toEqual([1, 2, '…', 10]);
  });

  it('elides on both sides in the middle', () => {
    expect(pageNumbers(5, 10)).toEqual([1, '…', 4, 5, 6, '…', 10]);
  });

  it('elides the run around the last page', () => {
    expect(pageNumbers(10, 10)).toEqual([1, '…', 9, 10]);
  });

  it('never repeats the first or last page', () => {
    for (const page of [1, 2, 3, 4, 5, 8, 9, 10]) {
      const nums = pageNumbers(page, 10).filter((n) => typeof n === 'number');
      expect(new Set(nums).size).toBe(nums.length);
    }
  });
});

describe('showingRange', () => {
  it('describes the slice the current page holds', () => {
    expect(showingRange(1, 50, 120)).toEqual({ start: 1, end: 50 });
    expect(showingRange(2, 50, 120)).toEqual({ start: 51, end: 100 });
    expect(showingRange(3, 50, 120)).toEqual({ start: 101, end: 120 });
  });

  it('stops the end at the total rather than at the page boundary', () => {
    expect(showingRange(1, 50, 7)).toEqual({ start: 1, end: 7 });
  });

  // Nothing to show. Reported as 0–0 rather than as 1–0, which reads as broken.
  it('reports an empty table as no range at all', () => {
    expect(showingRange(1, 50, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('monthLabel', () => {
  it('joins the round month and year the way the history rows read', () => {
    expect(monthLabel({ month: 'September', year: 2026 })).toBe('September 2026');
  });
});

describe('averagePlacement', () => {
  // Only qualified rounds have a placement, so only they can average into one.
  it('averages the placements a player actually has', () => {
    expect(averagePlacement([{ placement: 1 }, { placement: 2 }, { placement: 3 }])).toBe(2);
  });

  it('rounds to one decimal, matching the tile', () => {
    expect(averagePlacement([{ placement: 1 }, { placement: 2 }, { placement: 8 }])).toBe(3.7);
  });

  it('ignores rounds that were never placed', () => {
    expect(averagePlacement([{ placement: 2 }, { placement: null }, { placement: 4 }])).toBe(3);
  });

  it('is absent when no round was ever placed', () => {
    expect(averagePlacement([])).toBeNull();
    expect(averagePlacement([{ placement: null }, { placement: null }])).toBeNull();
  });
});
