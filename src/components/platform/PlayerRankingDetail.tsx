import React, { useEffect, useState } from 'react';
import { ArrowLeft, Crown, Medal, Trophy, ExternalLink, RefreshCw, AlertCircle } from 'lucide-react';
import { api, ApiPlayerDzppRound, ApiRankingEntry } from '../../api/client';
import { averagePlacement, monthLabel } from '../../lib/rankings';

// ── ONE PLAYER'S DZPP ─────────────────────────────────────────────────────────
//
// The panel behind a row of the DZ Performance Rankings: the player's totals, and every
// finalized round that produced them.
//
// IT CARRIES THE WHOLE BREAKDOWN, not just each round's total. That is the reason
// round_dzpp stores the terms separately rather than only the sum: a table of totals with no
// visible derivation is a table people argue with rather than chase. Every figure here comes
// from GET /api/rankings/:userId — nothing is recomputed against the formula, because the
// stored row IS the answer and a second opinion in the client could disagree with it.
//
// The history read is its own, rather than being handed down: it is wanted only when a row is
// opened, and fetching it here keeps its loading and error states beside what they describe.

interface PlayerRankingDetailProps {
  entry: ApiRankingEntry;
  /** The season being viewed. Null is all-time, and scopes the history to match the table. */
  year: number | null;
  /** "All-time" or "2026", for the line under the username. */
  scopeLabel: string;
  onBack: () => void;
}

function DetailAvatar({ username, avatarUrl, size }: { username: string; avatarUrl: string; size: number }) {
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
        className="rounded-full object-cover bg-slate-800"
      />
    );
  }
  return (
    <div
      style={{ width: dim, height: dim }}
      className="rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center"
    >
      <span className="text-lg font-black text-slate-400">{username.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

/**
 * A round's finishing position. Null is not a position: only qualified plays are placed, so a
 * round the player did not qualify in says so rather than rendering "#null".
 */
function PlacementBadge({ placement }: { placement: number | null }) {
  if (placement === null) {
    return <span className="text-slate-600 text-[11px] font-normal">not qualified</span>;
  }
  if (placement === 1) return <span className="inline-flex items-center gap-1 text-amber-400"><Crown className="w-3.5 h-3.5" /> #1</span>;
  if (placement === 2) return <span className="inline-flex items-center gap-1 text-slate-300"><Medal className="w-3.5 h-3.5" /> #2</span>;
  if (placement === 3) return <span className="inline-flex items-center gap-1 text-amber-700"><Medal className="w-3.5 h-3.5" /> #3</span>;
  return <span className="text-slate-400">#{placement}</span>;
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 border ${accent ? 'bg-amber-400/5 border-amber-400/25' : 'bg-slate-900/60 border-slate-800'}`}>
      <div className={`text-[9px] uppercase tracking-wider font-mono mb-1 ${accent ? 'text-amber-400/60' : 'text-slate-600'}`}>{label}</div>
      <div className={`text-lg font-black font-mono tabular-nums ${accent ? 'text-amber-400' : 'text-white'}`}>{value}</div>
    </div>
  );
}

/**
 * Where a round's DZPP came from, term by term.
 *
 * A null performance value reads as "no pp" rather than as 0.00: osu! awards no pp on a Loved
 * beatmap, and "osu! rated this play at nothing" and "osu! did not rate this play" are
 * different facts. The nullable column exists to keep them apart, so the page does too.
 */
function Breakdown({ round }: { round: ApiPlayerDzppRound }) {
  const term = (value: number, label: string) => (
    <span className="whitespace-nowrap">
      <span className="text-slate-400 tabular-nums">{value}</span>{' '}
      <span className="text-slate-600">{label}</span>
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono mt-1">
      {round.performanceValue === null ? (
        <span className="text-slate-600 whitespace-nowrap">no pp</span>
      ) : (
        <span className="whitespace-nowrap">
          <span className="text-sky-300/80 tabular-nums">{round.performanceValue.toFixed(2)}</span>{' '}
          <span className="text-slate-600">pp</span>
        </span>
      )}
      <span className="text-slate-700">+</span>
      {term(round.completionPoints, 'completion')}
      {round.qualified && (
        <>
          <span className="text-slate-700">+</span>
          {term(round.qualificationPoints, 'qualification')}
          <span className="text-slate-700">+</span>
          {term(round.placementPoints, 'placement')}
        </>
      )}
      <span className="text-slate-700">·</span>
      <span className="text-slate-600 whitespace-nowrap">
        field of <span className="tabular-nums">{round.fieldSize}</span>
      </span>
    </div>
  );
}

export function PlayerRankingDetail({ entry, year, scopeLabel, onBack }: PlayerRankingDetailProps) {
  const [history, setHistory] = useState<ApiPlayerDzppRound[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Re-read when the season changes, so the history always describes the table it was opened
  // from. client.ts resolves a failed read and an empty one both to null, hence the separate
  // flag: "this player has no counted rounds" and "the API is down" must not look alike.
  useEffect(() => {
    let live = true;
    setHistory(null);
    setFailed(false);
    void (async () => {
      const rounds = await api.rankings.player(entry.userId, year ?? undefined);
      if (!live) return;
      setHistory(rounds ?? []);
      setFailed(rounds === null);
    })();
    return () => { live = false; };
  }, [entry.userId, year]);

  const rounds = history ?? [];
  const average = averagePlacement(rounds);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">

      <button
        type="button"
        onClick={onBack}
        className={`inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white transition-colors mb-6 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70`}
      >
        <ArrowLeft className="w-4 h-4" /> Rankings
      </button>

      <div className="bg-[#0d1526] border border-slate-800 rounded-2xl px-6 py-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="ring-2 ring-amber-400/50 rounded-full p-1 self-start">
            <DetailAvatar username={entry.username} avatarUrl={entry.avatarUrl} size={72} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg" aria-hidden="true">🇩🇿</span>
              <h1 className="text-2xl font-black text-white truncate">{entry.username}</h1>
              {/* The osu! profile, because this platform has no profile page of its own. */}
              <a
                href={`https://osu.ppy.sh/users/${entry.osuId}`}
                target="_blank"
                rel="noreferrer noopener"
                className={`inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-amber-400 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70`}
                aria-label={`Open the osu! profile for ${entry.username} in a new tab`}
              >
                osu! profile <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="text-[12px] text-slate-500 font-mono mt-1">
              {scopeLabel} DZPP rank <span className="text-white font-bold">#{entry.rank}</span> · Algeria
            </p>
          </div>

          <div className="text-right self-start sm:self-center">
            <div className="text-4xl font-black font-mono text-amber-400 tabular-nums leading-none">
              {entry.dzpp.toLocaleString()}
            </div>
            <div className="text-[11px] font-black font-mono text-amber-400/70 tracking-widest mt-1">DZPP</div>
            <div className="text-[10px] text-slate-600 font-mono mt-0.5">osu!DZ points · not osu! pp</div>
          </div>
        </div>

        {/* Challenges and wins come from the ranking row; the average is computed from the
            placements in the history below, and best placement is null for a player who has
            never qualified in a counted round. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <StatTile label="Challenges" value={String(entry.roundsPlayed)} />
          <StatTile label="Wins" value={String(entry.firstPlaces)} />
          <StatTile
            label="Avg Placement"
            value={history === null ? '…' : average === null ? '—' : `#${average}`}
          />
          <StatTile
            label="Best Placement"
            value={entry.bestPlacement === null ? '—' : `#${entry.bestPlacement}`}
            accent
          />
        </div>
      </div>

      <div className="bg-[#0d1526] border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">DZPP History</h2>
          <span className="text-[10px] text-slate-600 font-mono uppercase tracking-wider">
            {history === null ? '…' : `${rounds.length} challenge${rounds.length !== 1 ? 's' : ''}`}
          </span>
        </div>

        {history === null && !failed ? (
          <div className="min-h-[200px] flex flex-col items-center justify-center gap-3 text-slate-500">
            <RefreshCw className="w-8 h-8 animate-spin text-amber-400/60" />
            <span className="text-sm font-mono">Loading DZPP history…</span>
          </div>
        ) : failed ? (
          <div className="min-h-[200px] flex flex-col items-center justify-center gap-3 text-slate-500">
            <AlertCircle className="w-8 h-8 text-rose-400" />
            <span className="text-sm font-mono">Could not load this history.</span>
          </div>
        ) : rounds.length === 0 ? (
          <div className="min-h-[200px] flex flex-col items-center justify-center gap-3 text-slate-600">
            <Trophy className="w-9 h-9" />
            <span className="text-sm font-mono">
              No challenge history for {scopeLabel.toLowerCase()} yet.
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 px-5 py-2 bg-slate-900/30 border-b border-slate-800/40">
              <span className="w-28 flex-shrink-0 text-[10px] text-slate-600 font-mono uppercase tracking-wider">Month</span>
              <span className="flex-1 min-w-0 text-[10px] text-slate-600 font-mono uppercase tracking-wider">Challenge</span>
              <span className="hidden sm:block w-24 flex-shrink-0 text-[10px] text-slate-600 font-mono uppercase tracking-wider text-right">Placement</span>
              <span className="w-24 flex-shrink-0 text-[10px] text-amber-400 font-mono uppercase tracking-wider text-right">DZPP</span>
            </div>

            <ul role="list" className="divide-y divide-slate-800/40">
              {rounds.map((round) => (
                <li
                  key={round.roundId}
                  className={`flex items-start gap-4 px-5 py-3 transition-colors ${
                    round.placement === 1 ? 'bg-amber-400/[0.03] hover:bg-amber-400/[0.06]' : 'hover:bg-slate-800/20'
                  }`}
                >
                  <span className="w-28 flex-shrink-0 text-xs font-mono text-slate-500 pt-0.5">
                    {monthLabel(round)}
                  </span>

                  <div className="flex-1 min-w-0">
                    {/* "Round N" rather than a challenge name: a round has a number, a month
                        and a winning beatmap, and no title of its own anywhere in this
                        project. */}
                    <div className="text-sm font-bold text-white truncate">Round {round.roundNumber}</div>
                    <Breakdown round={round} />
                    {/* The placement column is hidden on a narrow screen, so it moves here. */}
                    <div className="sm:hidden text-[11px] font-mono font-bold mt-1">
                      <PlacementBadge placement={round.placement} />
                    </div>
                  </div>

                  <span className="hidden sm:flex w-24 flex-shrink-0 text-xs font-mono font-bold text-right justify-end pt-0.5">
                    <PlacementBadge placement={round.placement} />
                  </span>

                  <span className="w-24 flex-shrink-0 text-right tabular-nums pt-0.5">
                    <span className="text-sm font-black font-mono text-amber-400">+{round.finalDzpp}</span>
                    <span className="text-[10px] text-slate-500 font-mono ml-0.5">DZPP</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="text-center text-[10px] text-slate-700 font-mono mt-8">
        DZPP is earned only from monthly challenge performances · distinct from osu! global pp
      </p>
    </div>
  );
}
