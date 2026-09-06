import React, { useEffect, useMemo, useState } from 'react';
import {
  Crown, Medal, ChevronLeft, ChevronRight,
  RefreshCw, Trophy, AlertCircle, BarChart2, Search, SearchX, X,
} from 'lucide-react';
import { api, ApiRankingEntry, ApiRankingPage } from '../../api/client';
import { AuthUser } from './NavHeader';
import { PlayerRankingDetail } from './PlayerRankingDetail';
import { pageNumbers, showingRange, totalPages } from '../../lib/rankings';

// ── DZ PERFORMANCE RANKINGS ───────────────────────────────────────────────────
//
// The cumulative DZPP table. Public: the archive is public too, and a ranking nobody can see
// without signing in is not a ranking.
//
// EVERY NUMBER COMES FROM GET /api/rankings. The server decides who appears — Algeria only,
// filtered inside the query in server/src/repo/dzpp.ts — and in what order, and it sends the
// rank on every row. This page never re-sorts, never re-filters by country, and never
// recomputes a total against the formula: a second opinion in the client is exactly what
// would drift from the frozen rows.
//
// DZPP IS NOT osu! pp, and the page says so twice on purpose. It is earned only by playing
// the monthly challenges, and no osu! profile total or global rank feeds into it.

interface RankingsPageProps {
  /** The signed-in account, so the caller's own row can be marked. Null when signed out. */
  user?: AuthUser | null;
}

function Avatar({ username, avatarUrl, size = 32 }: { username: string; avatarUrl: string; size?: number }) {
  const [imgErr, setImgErr] = useState(false);
  const dim = `${size}px`;

  if (avatarUrl && !imgErr) {
    return (
      <img
        src={avatarUrl}
        alt={username}
        onError={() => setImgErr(true)}
        referrerPolicy="no-referrer"
        style={{ width: dim, height: dim }}
        className="rounded-full object-cover flex-shrink-0 bg-slate-800"
      />
    );
  }
  return (
    <div
      style={{ width: dim, height: dim }}
      className="rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0"
    >
      <span className="text-[10px] font-black text-slate-400">{username.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="w-5 h-5 text-amber-400 flex-shrink-0" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-slate-300 flex-shrink-0" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-amber-700 flex-shrink-0" />;
  return (
    <span className="text-sm font-black font-mono text-slate-500 tabular-nums w-5 text-center flex-shrink-0">
      {rank}
    </span>
  );
}

function PodiumCard({
  entry,
  tier,
  onSelect,
}: {
  entry: ApiRankingEntry;
  tier: 'gold' | 'silver' | 'bronze';
  onSelect: (entry: ApiRankingEntry) => void;
}) {
  const tierCfg = {
    gold:   { ring: 'ring-amber-400/60',  rankColor: 'text-amber-400',  barBg: 'bg-amber-400',  barH: 'h-16', label: '#1' },
    silver: { ring: 'ring-slate-300/40',  rankColor: 'text-slate-300',  barBg: 'bg-slate-400',  barH: 'h-10', label: '#2' },
    bronze: { ring: 'ring-amber-700/50',  rankColor: 'text-amber-600',  barBg: 'bg-amber-800',  barH: 'h-7',  label: '#3' },
  }[tier];

  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      aria-label={`#${entry.rank} ${entry.username}, ${entry.dzpp} DZPP, ${entry.firstPlaces} wins — open DZPP history`}
      className={`flex flex-col items-center gap-2 group cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-inset`}
    >
      <span className={`text-[11px] font-black font-mono ${tierCfg.rankColor} tracking-widest`}>
        {tierCfg.label}
      </span>

      <div className={`ring-2 ${tierCfg.ring} rounded-full p-0.5 transition-all group-hover:ring-opacity-100`}>
        <Avatar username={entry.username} avatarUrl={entry.avatarUrl} size={tier === 'gold' ? 56 : 48} />
      </div>

      <div className="text-center">
        <div className="flex items-center justify-center gap-1">
          <span className="text-sm" aria-hidden="true">🇩🇿</span>
          <span className="text-sm font-bold text-white truncate max-w-[100px] group-hover:text-amber-400 transition-colors">
            {entry.username}
          </span>
        </div>
        <div className={`text-base font-black font-mono ${tierCfg.rankColor} tabular-nums`}>
          {entry.dzpp.toLocaleString()}
          <span className="text-[10px] font-normal text-slate-500 ml-0.5">DZPP</span>
        </div>
        {/* The design showed an average placement here; the ranking endpoint carries none, so
            this reads the two counts it does carry. */}
        <div className="text-[10px] text-slate-500 font-mono">
          {entry.firstPlaces} win{entry.firstPlaces !== 1 ? 's' : ''} · {entry.roundsPlayed} played
        </div>
      </div>

      <div className={`w-16 ${tierCfg.barH} ${tierCfg.barBg} opacity-30 rounded-t-sm mt-auto`} />
    </button>
  );
}

/**
 * Server-side pagination. `page`, `pageSize` and `total` all come from the API response, so
 * the control describes the real table rather than whatever happens to be in memory.
 */
function Pagination({
  page,
  pages,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const { start, end } = showingRange(page, pageSize, total);
  const nums = useMemo(() => pageNumbers(page, pages), [page, pages]);
  const btnBase =
    'flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold transition-all ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-inset';
  const idle = 'border border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-white';

  return (
    <nav aria-label="Rankings pages" className="flex flex-wrap items-center justify-between gap-3 mt-4 px-1">
      <span className="text-[11px] text-slate-500 font-mono">
        Showing {start}–{end} of {total} player{total !== 1 ? 's' : ''}
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
          className={`${btnBase} ${idle} disabled:opacity-30 disabled:cursor-not-allowed`}
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`ellipsis-${i}`} aria-hidden="true" className="w-8 text-center text-slate-600 text-xs">…</span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onPage(n)}
              aria-label={`Page ${n}`}
              aria-current={n === page ? 'page' : undefined}
              className={`${btnBase} ${n === page ? 'bg-amber-400 text-slate-950' : idle}`}
            >
              {n}
            </button>
          )
        )}

        <button
          type="button"
          disabled={page === pages}
          onClick={() => onPage(page + 1)}
          className={`${btnBase} ${idle} disabled:opacity-30 disabled:cursor-not-allowed`}
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </nav>
  );
}

export function RankingsPage({ user }: RankingsPageProps) {
  /** Null is all-time, which is the default view. A number is that calendar season. */
  const [year, setYear] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ApiRankingEntry | null>(null);
  const [board, setBoard] = useState<ApiRankingPage | null>(null);
  const [failed, setFailed] = useState(false);
  /** Bumped by the retry button. A state value that actually changes is what re-runs the read. */
  const [reload, setReload] = useState(0);
  /** A refetch is in flight over a board already on screen. Distinct from the first load. */
  const [busy, setBusy] = useState(false);

  // Read here rather than in App's refresh, following ArchivePage: no other surface wants this
  // data, and it only changes when a round is finalized. client.ts collapses a failed read and
  // an empty one both to null, so `failed` is what keeps "nobody has points yet" and "the API
  // is down" from looking identical.
  useEffect(() => {
    let live = true;
    setBusy(true);
    setFailed(false);
    void (async () => {
      const next = await api.rankings.list({
        year: year ?? undefined,
        page: page === 1 ? undefined : page,
      });
      if (!live) return;
      setBoard(next);
      setFailed(next === null);
      setBusy(false);
    })();
    return () => { live = false; };
  }, [year, page, reload]);

  const entries = board?.entries ?? [];
  const years = board?.years ?? [];
  const total = board?.total ?? 0;
  const pageSize = board?.pageSize ?? 50;
  const pages = totalPages(total, pageSize);
  const scopeLabel = year === null ? 'All-time' : String(year);
  const searching = query.trim() !== '';

  // CLIENT-SIDE, over the rows this page already holds. There is no search endpoint, and with
  // fewer than fifty ranked players the whole table arrives in one response, so filtering here
  // is the honest thing rather than a stand-in for one. If the table ever outgrows a page the
  // note below says plainly that only this page was searched.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return entries;
    return entries.filter((entry) => entry.username.toLowerCase().includes(q));
  }, [entries, query]);

  // The podium is the top three of the WHOLE table, so it belongs to the first page only, and
  // it steps aside while a search is narrowing the rows.
  const top3 = searching || page !== 1 ? [] : entries.slice(0, 3);

  // Derived, not an API field: the caller's own row, when it is on the page in front of them.
  // Nothing in the API returns a rank for a player who is not, so the card stays hidden rather
  // than guessing one.
  const me = user ? entries.find((entry) => entry.userId === user.id) ?? null : null;

  function goToPage(next: number) {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Detail view ───────────────────────────────────────────────────────────
  // A full-page swap rather than an overlay, matching how App switches between pages. The
  // panel reads its own history, scoped to the same season the table is showing.
  if (selected) {
    return (
      <PlayerRankingDetail
        entry={selected}
        year={year}
        scopeLabel={scopeLabel}
        onBack={() => setSelected(null)}
      />
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (board === null && !failed) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="min-h-[400px] flex flex-col items-center justify-center gap-4 text-slate-500">
          <RefreshCw className="w-8 h-8 animate-spin text-amber-400/60" />
          <span className="text-sm font-mono">Loading rankings…</span>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (failed) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="min-h-[400px] flex flex-col items-center justify-center gap-4 text-slate-500">
          <AlertCircle className="w-8 h-8 text-rose-400" />
          <span className="text-sm font-mono">Could not load the rankings.</span>
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            className="text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart2 className="w-4 h-4 text-amber-400" />
            <span className="text-[10px] uppercase tracking-widest font-black font-mono text-slate-500">
              Performance Rankings
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-none">
            DZ Performance Rankings
          </h1>
          <p className="text-[13px] text-slate-500 mt-1.5 font-mono">
            Algeria only · ranked by{' '}
            <span className="text-amber-400 font-bold">DZPP</span> — osu!DZ challenge points,{' '}
            <span className="text-slate-400">not</span> osu! pp
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* The whole table, not this page. */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-2.5 text-center">
            <div className="text-[9px] text-slate-600 uppercase tracking-wider font-mono mb-0.5">Players</div>
            <div className="text-lg font-black font-mono text-white tabular-nums">{total}</div>
          </div>
          {me && (
            <div className="bg-amber-400/5 border border-amber-400/25 rounded-xl px-4 py-2.5 text-center">
              <div className="text-[9px] text-amber-400/60 uppercase tracking-wider font-mono mb-0.5">Your Rank</div>
              <div className="text-lg font-black font-mono text-amber-400 tabular-nums">#{me.rank}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Controls: scope · year · search ──────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* The Yearly half is offered only when a season actually holds points, so the control
            can never lead somewhere empty. `years` comes from the API for that reason. */}
        <div className="inline-flex items-center bg-slate-900/80 border border-slate-800 rounded-xl p-1">
          <button
            type="button"
            onClick={() => { setYear(null); setPage(1); }}
            aria-pressed={year === null}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-inset ${
              year === null ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            All-time
          </button>
          {years.length > 0 && (
            <button
              type="button"
              onClick={() => { setYear(years[0]); setPage(1); }}
              aria-pressed={year !== null}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-inset ${
                year !== null ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              Yearly
            </button>
          )}
        </div>

        {year !== null && (
          <div role="group" aria-label="Season" className="inline-flex items-center gap-1 flex-wrap">
            {years.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => { setYear(y); setPage(1); }}
                aria-pressed={year === y}
                aria-label={`Season ${y}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all border focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-inset ${
                  year === y
                    ? 'bg-amber-400/10 border-amber-400/30 text-amber-400'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600 hover:text-white'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        )}

        <div className="relative sm:ml-auto w-full sm:w-56">
          <Search className="w-3.5 h-3.5 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search player…"
            aria-label="Search players on this page"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-8 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-400/40 transition-colors font-mono"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Only reachable once the table outgrows a single response. Until then the search covers
          every ranked player, and saying otherwise would be noise. */}
      {searching && total > pageSize && (
        <p className="text-[11px] text-amber-400/70 font-mono mb-4">
          Searching this page only — {total} players span {pages} pages.
        </p>
      )}

      <p aria-live="polite" className="sr-only">
        {busy
          ? 'Updating rankings'
          : searching
            ? `${filtered.length} of ${entries.length} players match ${query.trim()}`
            : `${scopeLabel} rankings, ${total} player${total === 1 ? '' : 's'}, page ${page} of ${pages}`}
      </p>

      <div className={`transition-opacity ${busy ? 'opacity-50' : ''}`}>
      {total === 0 ? (
        /* ── Empty: nothing has been finalized for this scope ─────────────── */
        <div className="bg-[#0d1526] border border-slate-800 rounded-2xl min-h-[320px] flex flex-col items-center justify-center gap-4 text-slate-600 px-6 text-center">
          <Trophy className="w-10 h-10" />
          <span className="text-sm font-mono">
            {year === null
              ? 'No DZPP has been awarded yet.'
              : `No DZPP rankings for ${scopeLabel} yet.`}
          </span>
          <span className="text-[11px] font-mono text-slate-700 max-w-sm">
            DZPP is frozen when a monthly challenge ends, so the table fills in as rounds close.
          </span>
        </div>
      ) : (
        <>
          {top3.length >= 3 && (
            <div className="bg-[#0d1526] border border-slate-800 rounded-2xl px-4 sm:px-6 py-8 mb-6">
              <div className="flex items-end justify-center gap-4 sm:gap-12">
                <PodiumCard entry={top3[1]} tier="silver" onSelect={setSelected} />
                <PodiumCard entry={top3[0]} tier="gold" onSelect={setSelected} />
                <PodiumCard entry={top3[2]} tier="bronze" onSelect={setSelected} />
              </div>
            </div>
          )}

          {searching && filtered.length === 0 ? (
            /* ── No search results ───────────────────────────────────────── */
            <div className="bg-[#0d1526] border border-slate-800 rounded-2xl min-h-[240px] flex flex-col items-center justify-center gap-3 text-slate-500 px-6 text-center">
              <SearchX className="w-9 h-9 text-slate-600" />
              <span className="text-sm font-mono">No players match “{query.trim()}”</span>
              <button
                type="button"
                onClick={() => setQuery('')}
                className={`text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-inset`}
              >
                Clear search
              </button>
            </div>
          ) : (
            <>
              {/* ── Rankings table ───────────────────────────────────────── */}
              {/* The Avg Plc column the design carried is absent: GET /api/rankings returns no
                  average placement, and inventing one client-side is impossible from a page of
                  totals. It survives on the player panel, where the per-round placements are
                  actually available. */}
              <div className="bg-[#0d1526] border border-slate-800 rounded-2xl overflow-hidden">
                <div aria-hidden="true" className="flex items-center gap-3 px-4 sm:px-5 py-2.5 bg-slate-900/40 border-b border-slate-800/60">
                  <div className="w-10 flex-shrink-0 text-[10px] text-slate-600 font-mono uppercase tracking-wider text-center">#</div>
                  <div className="flex-1 min-w-0 text-[10px] text-slate-600 font-mono uppercase tracking-wider">Player</div>
                  <div className="hidden sm:block w-20 flex-shrink-0 text-[10px] text-slate-600 font-mono uppercase tracking-wider text-right">Played</div>
                  <div className="w-16 flex-shrink-0 text-[10px] text-slate-600 font-mono uppercase tracking-wider text-right">Wins</div>
                  <div className="hidden sm:block w-20 flex-shrink-0 text-[10px] text-slate-600 font-mono uppercase tracking-wider text-right">Best Plc</div>
                  <div className="w-24 sm:w-28 flex-shrink-0 text-[10px] text-amber-400 font-mono uppercase tracking-wider text-right">Total DZPP</div>
                </div>

                <div className="divide-y divide-slate-800/40">
                  {filtered.map((entry) => {
                    const isMe = user !== null && user !== undefined && entry.userId === user.id;
                    return (
                      <button
                        key={entry.userId}
                        type="button"
                        onClick={() => setSelected(entry)}
                        aria-label={
                          `Rank ${entry.rank}, ${entry.username}${isMe ? ' (you)' : ''}, ` +
                          `${entry.dzpp} DZPP, ${entry.roundsPlayed} challenges played, ` +
                          `${entry.firstPlaces} wins, best placement ` +
                          `${entry.bestPlacement === null ? 'none' : entry.bestPlacement}` +
                          ' — open DZPP history'
                        }
                        className={`w-full flex items-center gap-3 px-4 sm:px-5 py-3 transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-inset ${
                          isMe
                            ? 'bg-amber-400/5 border-l-2 border-l-amber-400 hover:bg-amber-400/10'
                            : 'hover:bg-slate-800/30'
                        }`}
                      >
                        <div className="w-10 flex-shrink-0 flex justify-center">
                          <RankBadge rank={entry.rank} />
                        </div>

                        <div className="flex-1 min-w-0 flex items-center gap-2.5">
                          <Avatar username={entry.username} avatarUrl={entry.avatarUrl} size={32} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm" aria-hidden="true">🇩🇿</span>
                              <span className={`text-sm font-bold truncate ${isMe ? 'text-amber-400' : 'text-white'}`}>
                                {entry.username}
                              </span>
                              {isMe && (
                                <span className="text-[10px] text-amber-400/60 font-normal flex-shrink-0">(you)</span>
                              )}
                            </div>
                            {/* The columns hidden below sm, folded into the name cell. */}
                            <div className="sm:hidden text-[10px] text-slate-500 font-mono mt-0.5">
                              {entry.roundsPlayed} played · best{' '}
                              {entry.bestPlacement === null ? '—' : `#${entry.bestPlacement}`}
                            </div>
                          </div>
                        </div>

                        <div className="hidden sm:block w-20 flex-shrink-0 text-sm font-mono text-slate-400 text-right tabular-nums">
                          {entry.roundsPlayed}
                        </div>

                        <div className={`w-16 flex-shrink-0 text-sm font-mono text-right tabular-nums font-bold ${
                          entry.firstPlaces > 0 ? 'text-emerald-400' : 'text-slate-600'
                        }`}>
                          {entry.firstPlaces}
                        </div>

                        {/* Null for a player who has never qualified — not a zero, and not a #0. */}
                        <div className="hidden sm:block w-20 flex-shrink-0 text-sm font-mono text-slate-400 text-right tabular-nums">
                          {entry.bestPlacement === null ? '—' : `#${entry.bestPlacement}`}
                        </div>

                        <div className="w-24 sm:w-28 flex-shrink-0 text-right">
                          <span className="text-base font-black font-mono text-amber-400 tabular-nums">
                            {entry.dzpp.toLocaleString()}
                          </span>
                          <span className="hidden sm:inline text-[10px] text-slate-500 font-mono ml-0.5">DZPP</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Server-side, so it is hidden while a client-side search is narrowing the rows —
                  paging a filtered subset of one page would page nothing. */}
              {!searching && pages > 1 && (
                <Pagination page={page} pages={pages} pageSize={pageSize} total={total} onPage={goToPage} />
              )}
            </>
          )}
        </>
      )}
      </div>

      <p className="text-center text-[10px] text-slate-700 font-mono mt-8">
        DZPP is earned only from monthly challenge performances · Algeria only · distinct from osu! global pp
      </p>
    </div>
  );
}
