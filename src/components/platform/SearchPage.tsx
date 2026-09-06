// Beatmap search, over the real osu! API.
//
// The page fetches for itself rather than through App's refresh, the same way ArchivePage does: a
// search is a per-keystroke read that only this page wants, and putting it in the shared refresh
// would run it on every page load.
//
// SEARCHING IS THE PRIMARY ACTION, which it was not before. The page used to offer one text box
// and then two buttons labelled "★ Stars" and "BPM" — which were SORTS wearing the shape of
// search modes, so the only way to narrow a result set was to retype the title. Title, mapper,
// star range and BPM range are now real filters, and sorting is a separate control that says so.
//
// THE RANGES ARE SERVER-SIDE, inside osu!'s own advanced query (`stars>=5 bpm<=200`), so they
// narrow the whole result set rather than the screenful that came back. See buildSearchQuery in
// server/src/services/osu.ts. Ordering is the server's too: GET /api/search/beatmaps returns the
// results already ordered, so there is one implementation of it rather than a second one here.

import React, { useEffect, useState } from 'react';
import { BeatmapCardPlatform } from './BeatmapCardPlatform';
import { Search, Loader2, AlertCircle, LogIn, RotateCcw, User, Star, Activity } from 'lucide-react';
import { Beatmap, BeatmapStatus } from '../../types';
import { api, ApiSearchHit } from '../../api/client';
import { searchHitToBeatmap, beatmapUrl } from '../../lib/submission';

type StatusFilter = BeatmapStatus | 'all';
type Sort = 'relevance' | 'newest' | 'stars' | 'bpm';

/** Long enough that typing a title is one request, short enough to feel immediate. */
const DEBOUNCE_MS = 400;

/** Everything a search asks for, in one object so resetting is one assignment. */
interface Filters {
  q: string;
  mapper: string;
  minStars: string;
  maxStars: string;
  minBpm: string;
  maxBpm: string;
  status: StatusFilter;
  sort: Sort;
}

const EMPTY: Filters = {
  q: '',
  mapper: '',
  minStars: '',
  maxStars: '',
  minBpm: '',
  maxBpm: '',
  status: 'all',
  sort: 'relevance',
};

/**
 * The bounds travel as strings while they are being typed, because "5." and "" are both states a
 * number input passes through and neither is a number. Only a finite one is sent.
 */
const asBound = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
};

/** Whether anything at all has been asked for — what enables Reset and hides the caveats. */
const isPristine = (f: Filters): boolean =>
  f.q === '' && f.mapper === '' && f.minStars === '' && f.maxStars === '' &&
  f.minBpm === '' && f.maxBpm === '' && f.status === 'all' && f.sort === 'relevance';

interface SearchPageProps {
  /** osu! difficulty ids the caller has favorited, so a hit shows its real heart state. */
  favoritedIds: ReadonlySet<number>;
  onFavorite: (map: Beatmap) => void;
}

const SORTS: { key: Sort; label: string }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'newest', label: 'Newest' },
  { key: 'stars', label: '★ Stars' },
  { key: 'bpm', label: 'BPM' },
];

const STATUSES: { key: BeatmapStatus; label: string; activeClass: string }[] = [
  { key: 'ranked',   label: 'Ranked',   activeClass: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400' },
  { key: 'loved',    label: 'Loved',    activeClass: 'bg-rose-500/15 border-rose-500/35 text-rose-400'          },
  { key: 'approved', label: 'Approved', activeClass: 'bg-blue-500/15 border-blue-500/35 text-blue-400'          },
];

const FIELD =
  'w-full bg-[#0d1526] border border-slate-800 focus:border-amber-400/50 rounded-xl text-sm ' +
  'text-slate-100 placeholder-slate-600 focus:outline-none transition-colors';

export function SearchPage({ favoritedIds, onFavorite }: SearchPageProps) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [results, setResults] = useState<ApiSearchHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const { q, mapper, minStars, maxStars, minBpm, maxBpm, status, sort } = filters;

  useEffect(() => {
    // `stale` rather than an AbortController: send() takes no signal, and what actually matters is
    // that a slow earlier response cannot overwrite a newer one.
    let stale = false;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      const res = await api.search.beatmaps({
        q,
        mapper,
        status: status === 'all' ? 'any' : status,
        sort,
        minStars: asBound(minStars),
        maxStars: asBound(maxStars),
        minBpm: asBound(minBpm),
        maxBpm: asBound(maxBpm),
      });
      if (stale) return;
      setLoading(false);

      if (res.ok) {
        setResults(res.data.results);
        setError(null);
        setSignedOut(false);
        return;
      }

      // 401 gets the page's own copy. The server answers "Not authenticated", which is true and
      // tells a player nothing about what to do about it.
      setResults([]);
      setSignedOut(res.status === 401);
      setError(res.status === 401 ? null : res.error);
    }, DEBOUNCE_MS);

    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [q, mapper, minStars, maxStars, minBpm, maxBpm, status, sort]);

  const pristine = isPristine(filters);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-16">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono mb-1">Beatmap Search</p>
        <h1 className="text-2xl font-black text-white mb-2 tracking-tight">Find Beatmaps</h1>
        <p className="text-sm text-slate-400">
          Search Ranked, Loved, and Approved beatmaps on osu!. Open one to pick a difficulty, then
          submit its link for the monthly challenge.
        </p>
      </div>

      {/* ── The search form. Text and mapper are the two things people actually search by, so
             they lead; the ranges sit beside them rather than behind a disclosure, because a
             hidden filter is a filter nobody uses. ─────────────────────────────────────── */}
      <div className="bg-[#0d1526] border border-slate-800 rounded-2xl p-4 sm:p-5 mb-5 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              type="search"
              value={q}
              onChange={(e) => set('q', e.target.value)}
              placeholder="Title or artist…"
              aria-label="Search by title or artist"
              className={`${FIELD} pl-10 pr-4 py-3`}
            />
          </div>
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              type="search"
              value={mapper}
              onChange={(e) => set('mapper', e.target.value)}
              placeholder="Mapper…"
              aria-label="Search by mapper"
              className={`${FIELD} pl-10 pr-4 py-3`}
            />
          </div>
        </div>

        {/* Ranges. Two numbers each, inclusive both ends, and the server refuses an inverted
            pair rather than answering "no beatmaps found". */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div role="group" aria-label="Star rating range" className="flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-400/70 flex-shrink-0" />
            <input
              type="number" inputMode="decimal" step="0.1" min="0" max="20"
              value={minStars}
              onChange={(e) => set('minStars', e.target.value)}
              placeholder="min ★"
              aria-label="Minimum star rating"
              className={`${FIELD} px-3 py-2`}
            />
            <span className="text-slate-600 text-xs flex-shrink-0">to</span>
            <input
              type="number" inputMode="decimal" step="0.1" min="0" max="20"
              value={maxStars}
              onChange={(e) => set('maxStars', e.target.value)}
              placeholder="max ★"
              aria-label="Maximum star rating"
              className={`${FIELD} px-3 py-2`}
            />
          </div>

          <div role="group" aria-label="BPM range" className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-sky-400/70 flex-shrink-0" />
            <input
              type="number" inputMode="numeric" step="1" min="0" max="2000"
              value={minBpm}
              onChange={(e) => set('minBpm', e.target.value)}
              placeholder="min BPM"
              aria-label="Minimum BPM"
              className={`${FIELD} px-3 py-2`}
            />
            <span className="text-slate-600 text-xs flex-shrink-0">to</span>
            <input
              type="number" inputMode="numeric" step="1" min="0" max="2000"
              value={maxBpm}
              onChange={(e) => set('maxBpm', e.target.value)}
              placeholder="max BPM"
              aria-label="Maximum BPM"
              className={`${FIELD} px-3 py-2`}
            />
          </div>
        </div>

        {/* Status, sort, reset. Sort is a labelled control of its own now rather than two buttons
            that looked like search modes. */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <div role="group" aria-label="Beatmap status" className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-slate-600 font-mono">Status</span>
            {STATUSES.map(({ key, label, activeClass }) => (
              <button
                key={key}
                type="button"
                onClick={() => set('status', status === key ? 'all' : key)}
                aria-pressed={status === key}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 ${
                  status === key ? activeClass : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            <label htmlFor="search-sort" className="text-[10px] uppercase tracking-wider text-slate-600 font-mono">
              Sort
            </label>
            <select
              id="search-sort"
              value={sort}
              onChange={(e) => set('sort', e.target.value as Sort)}
              className="bg-slate-900 border border-slate-800 focus:border-amber-400/50 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-300 focus:outline-none transition-colors"
            >
              {SORTS.map(({ key, label }) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setFilters(EMPTY)}
              disabled={pristine}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
          </div>
        </div>
      </div>

      {/* Result count, and the one caveat worth stating */}
      <div className="mb-6 space-y-1" aria-live="polite">
        <p className="text-xs text-slate-600 font-mono">
          {loading ? 'Searching…' : `${results.length} result${results.length !== 1 ? 's' : ''}`}
          {q && !loading && <span className="text-slate-500"> for "{q}"</span>}
        </p>
        {sort === 'bpm' && !loading && results.length > 0 && (
          <p className="text-[11px] text-slate-600">
            osu! search cannot sort by BPM, so this orders the results above rather than every
            match. A BPM range, unlike a BPM sort, does filter every match.
          </p>
        )}
      </div>

      {/* Results, and the four states that are not results */}
      {loading ? (
        <div className="flex flex-col items-center gap-3 py-24 border border-dashed border-slate-800 rounded-2xl">
          <Loader2 className="w-8 h-8 text-slate-600 animate-spin" />
          <p className="text-slate-500 font-medium">Searching osu!…</p>
        </div>
      ) : signedOut ? (
        <div className="flex flex-col items-center gap-3 py-24 border border-dashed border-slate-800 rounded-2xl">
          <LogIn className="w-10 h-10 text-slate-700" />
          <p className="text-slate-400 font-medium">Sign in with osu! to search beatmaps.</p>
          <p className="text-xs text-slate-600 max-w-md text-center">
            Search runs against the osu! API on this server's quota, so it is limited per account.
          </p>
        </div>
      ) : error !== null ? (
        <div className="flex flex-col items-center gap-3 py-24 border border-dashed border-rose-500/25 rounded-2xl">
          <AlertCircle className="w-10 h-10 text-rose-500/60" />
          <p className="text-slate-300 font-medium">Search failed.</p>
          <p className="text-xs text-slate-500 max-w-md text-center">{error}</p>
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 border border-dashed border-slate-800 rounded-2xl px-6">
          <Search className="w-10 h-10 text-slate-700" />
          <p className="text-slate-500 font-medium">No beatmaps found.</p>
          <p className="text-xs text-slate-600 text-center max-w-sm">
            {pristine
              ? 'Search by title, artist or mapper, or narrow by star rating and BPM.'
              : 'Try widening a range or clearing a filter.'}
          </p>
          {!pristine && (
            <button
              type="button"
              onClick={() => setFilters(EMPTY)}
              className="text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors"
            >
              Reset all filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((hit) => (
            <div key={`${hit.beatmapsetId}-${hit.difficultyId}`} className="flex flex-col gap-1.5">
              <BeatmapCardPlatform
                beatmap={{
                  ...searchHitToBeatmap(hit),
                  isFavorited: favoritedIds.has(hit.difficultyId),
                }}
                onFavorite={() => onFavorite(searchHitToBeatmap(hit))}
              />
              <div className="flex items-center justify-between px-1">
                <p className="text-[10px] text-slate-600 font-mono">
                  {hit.difficultyCount > 1
                    ? `Shown of ${hit.difficultyCount} difficulties`
                    : 'Single difficulty'}
                </p>
                <a
                  href={beatmapUrl(hit)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] font-bold text-slate-500 hover:text-amber-400 transition-colors"
                >
                  Open on osu! →
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
