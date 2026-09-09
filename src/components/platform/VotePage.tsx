import React, { useCallback, useEffect, useState } from 'react';
import { BeatmapCard } from '../BeatmapCard';
import { Beatmap, BeatmapComment, PlatformPage } from '../../types';
import { api } from '../../api/client';
import { groupBySubmission } from '../../lib/comments';
import { CurrentRound, isBallotOpen, pageAccess, roundLabel, useCountdown } from '../../lib/round';
import { AuthUser, phaseConfig } from './NavHeader';
import { PhaseGate } from './PhaseGate';
import { Crown, Trophy, ChevronRight, LogIn, X, AlertCircle, Ban, Scale } from 'lucide-react';

// ── LOGIN MODAL ───────────────────────────────────────────────────────────────

function LoginModal({ onClose, onLogin }: { onClose: () => void; onLogin?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0d1526] border border-slate-700 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-600 hover:text-slate-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="w-16 h-16 rounded-full bg-amber-400/10 border border-amber-400/25 flex items-center justify-center mx-auto mb-5">
          <LogIn className="w-7 h-7 text-amber-400" />
        </div>
        <h3 className="text-lg font-black text-white mb-2">Login to vote</h3>
        <p className="text-sm text-slate-400 mb-6 leading-relaxed">
          Voting is limited to players from the participating countries. Log in with your osu! account
          to cast your vote.
        </p>
        <button
          type="button"
          onClick={() => { onLogin?.(); onClose(); }}
          className="w-full flex items-center justify-center gap-2 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-sm rounded-xl transition-all"
        >
          <LogIn className="w-4 h-4" />
          Login with osu!
        </button>
        <p className="text-[10px] text-slate-600 mt-3">You get one vote per round.</p>
      </div>
    </div>
  );
}

// ── VOTE STANDINGS PANEL ─────────────────────────────────────────────────────

function VoteStandings({
  maps,
  votedId,
  final,
  tiedTop,
}: {
  maps: Beatmap[];
  votedId: string | null;
  /** The ballot is closed, so these numbers cannot move again. */
  final?: boolean;
  /** The round ended level, so no single row gets the leader's colour. */
  tiedTop?: boolean;
}) {
  const sorted = [...maps].sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0));
  // Math.max, not `?? 1`: with a list of entries that all have zero votes the leader's
  // count is 0, and dividing by it printed "NaN%" and a `width: NaN%` bar.
  const maxVotes = Math.max(1, sorted[0]?.voteCount ?? 0);
  const topCount = sorted[0]?.voteCount ?? 0;

  return (
    <div className="bg-[#0d1526] border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-white">{final ? 'Final Standings' : 'Vote Standings'}</h3>
        </div>
        <span className="text-[10px] text-slate-600 font-mono">
          {maps.reduce((s, m) => s + (m.voteCount ?? 0), 0).toLocaleString()} total
        </span>
      </div>
      <div className="divide-y divide-slate-800/40">
        {sorted.map((m, i) => {
          const pct = Math.round(((m.voteCount ?? 0) / maxVotes) * 100);
          const isLeader = tiedTop ? (m.voteCount ?? 0) === topCount : i === 0;
          const isMyVote = m.id === votedId;
          return (
            <div key={m.id} className={`px-5 py-3 ${isMyVote ? 'bg-amber-400/4' : ''}`}>
              <div className="flex items-center gap-3 mb-1.5">
                <span className={`w-5 text-[11px] font-black font-mono flex-shrink-0 ${isLeader ? 'text-amber-400' : 'text-slate-600'}`}>
                  #{i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 justify-between mb-0.5">
                    <span className="text-xs font-bold text-white truncate">{m.title}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isMyVote && (
                        <span className="text-[9px] font-black text-amber-400 bg-amber-400/10 border border-amber-400/25 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                          You
                        </span>
                      )}
                      <span className="text-[11px] font-black font-mono text-white">{(m.voteCount ?? 0).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        isLeader ? 'bg-amber-400' : isMyVote ? 'bg-blue-400' : 'bg-slate-600'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <span className="w-8 text-[10px] font-mono text-slate-500 text-right flex-shrink-0">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── CLOSED BALLOT ────────────────────────────────────────────────────────────
//
// Voting closes on winner_status while the phase stays 'voting', so without this the
// page would look like an open ballot whose buttons had all quietly stopped working.
// The winner named here is the one the server recorded, never a leader recomputed
// from the counts — that recomputation is the thing the frozen result replaced.
//
// 'official' never reaches this page: approving a winner moves the round to the
// challenge phase in the same transaction, and pageAccess then shows PhaseGate
// instead. The official winner is on the dashboard's challenge hero.

function BallotClosed({
  round,
  winner,
  tiedTitles,
}: {
  round: CurrentRound;
  winner: Beatmap | null;
  tiedTitles: string[];
}) {
  const counts = `${round.winnerVoteCount ?? 0} of ${round.totalVotes ?? 0} votes cast`;

  if (round.winnerStatus === 'tiebreak') {
    return (
      <div className="flex items-start gap-3 bg-blue-500/8 border border-blue-500/25 rounded-2xl px-5 py-4 mb-8">
        <Scale className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-black text-white mb-1">Voting ended in a tie</p>
          <p className="text-xs text-slate-400 leading-relaxed">
            {tiedTitles.length > 0
              ? `${tiedTitles.length} entries finished level on ${counts}: ${tiedTitles.join(', ')}.`
              : `The top entries finished level on ${counts}.`}{' '}
            A tie is not resolved automatically — an administrator picks the winner. No more
            votes can be cast or retracted, and the standings below are final.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 bg-amber-400/8 border border-amber-400/25 rounded-2xl px-5 py-4 mb-8">
      <Crown className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-black text-white mb-1">Voting has closed</p>
        <p className="text-xs text-slate-400 leading-relaxed">
          {winner ? (
            <>
              <span className="text-amber-400 font-bold">{winner.title}</span> finished on top with{' '}
              {counts}.
            </>
          ) : (
            `The leading entry finished with ${counts}.`
          )}{' '}
          The result is not official until an administrator approves it. No more votes can be
          cast or retracted, and the standings below are final.
        </p>
      </div>
    </div>
  );
}

// ── VOTE ERROR BANNER ────────────────────────────────────────────────────────

function VoteError({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2.5 bg-rose-500/10 border border-rose-500/25 rounded-xl px-4 py-3 mb-6">
      <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-px" />
      <p className="text-xs text-rose-300 flex-1">{text}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
      >
        <X className="w-3.5 h-3.5 text-rose-300" />
      </button>
    </div>
  );
}

// ── VOTE PAGE ─────────────────────────────────────────────────────────────────

interface VotePageProps {
  maps: Beatmap[];
  round: CurrentRound | null;
  /** The caller's own entry. Voting for it is refused by the server, so it is refused here too. */
  mySubmissionId: number | null;
  /** False while App's first fetch is still in flight. */
  loading: boolean;
  /** Beatmap id whose cast or retract is in flight. */
  voteBusy: string | null;
  voteError: string | null;
  onDismissVoteError: () => void;
  playingId: string | null;
  audioProgress: (id: string) => number;
  onTogglePlay: (id: string) => void;
  onScrub: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onVote: (id: string) => void;
  /** Takes the map, not its id: favoriting addresses the osu! beatmap (A4). */
  onFavorite: (map: Beatmap) => void;
  onNavigate: (page: PlatformPage) => void;
  user: AuthUser | null;
  onLogin?: () => void;
}

export function VotePage({
  maps,
  round,
  mySubmissionId,
  loading,
  voteBusy,
  voteError,
  onDismissVoteError,
  playingId,
  audioProgress,
  onTogglePlay,
  onScrub,
  onVote,
  onFavorite,
  onNavigate,
  user,
  onLogin,
}: VotePageProps) {
  const sorted = [...maps].sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0));
  const leader = sorted[0];
  const totalVotes = maps.reduce((s, m) => s + (m.voteCount ?? 0), 0);
  const votedMap = maps.find((m) => m.isVoted);
  const [showAll, setShowAll] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const countdown = useCountdown(round?.endsAt);
  const visibleMaps = showAll ? sorted : sorted.slice(0, 6);

  // Whether this page is live at all comes from the one table in lib/round.ts, so the
  // nav tab, this body and the server's phase check cannot disagree.
  const access = pageAccess('vote', round);
  /**
   * The round's discussion, grouped by submission (B8).
   *
   * Fetched by this page rather than through App's refresh: a comment changes only this page,
   * and putting it in the shared refresh would reload the round, the submissions, the vote and
   * the leaderboard every time somebody typed a sentence.
   */
  const [comments, setComments] = useState<Map<number, BeatmapComment[]>>(new Map());

  const loadComments = useCallback(async () => {
    const rows = await api.comments.forRound(round?.id);
    setComments(groupBySubmission(rows ?? []));
  }, [round?.id]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  /**
   * Posts a comment and re-reads. Re-reading rather than splicing the new one in locally: the
   * server decides the id, the timestamp and the threading, and a local copy of any of those
   * is how the old panel ended up showing comments that did not exist.
   *
   * A vote-page Beatmap.id IS its submission id (toBeatmap makes it so), which is what makes
   * this addressable at all.
   */
  const addComment = async (
    map: Beatmap,
    body: string,
    parentId?: string
  ): Promise<string | null> => {
    const res = await api.comments.post(
      Number(map.id),
      body,
      parentId === undefined ? undefined : Number(parentId)
    );
    if (!res.ok) return res.error;
    await loadComments();
    return null;
  };

  const canVote = user?.canVote ?? false;
  // Beatmap ids are strings; submission ids are numbers.
  const myMapId = mySubmissionId === null ? null : String(mySubmissionId);
  const ownEntryListed = myMapId !== null && sorted.some((m) => m.id === myMapId);

  /**
   * The ballot is closed but the round has not moved on: the winner is pending or the
   * round is tied. Everything below reads this rather than the phase, which stays
   * 'voting' throughout — and it is narrower than !isBallotOpen, which is also true
   * before voting has started.
   */
  const frozen = round?.phase === 'voting' && !isBallotOpen(round);
  const tied = round?.winnerStatus === 'tiebreak';
  const recordedWinnerId =
    round?.winningSubmissionId == null ? null : String(round.winningSubmissionId);
  const recordedWinner = recordedWinnerId === null
    ? null
    : maps.find((m) => m.id === recordedWinnerId) ?? null;
  /**
   * Which entries are level at the top of a tied round. The counts cannot move once
   * the ballot is closed, so the entries matching the frozen winning count are exactly
   * the tied ones — the admin-only tiebreak list is not needed to say this much.
   */
  const tiedEntry = (m: Beatmap): boolean =>
    tied && round !== null && (m.voteCount ?? 0) === (round.winnerVoteCount ?? -1);

  /** Why this entry cannot be voted for, or undefined when it can. */
  const refusal = (id: string): string | undefined => {
    // First, because it applies to everybody — guests and the retraction of a vote
    // already cast included. The cards hide their vote button outright when frozen.
    if (frozen) return 'Voting has closed for this round';
    if (!user) return undefined; // A guest gets the login modal instead of a refusal.
    if (!canVote) return 'Your account is not eligible to vote in this round';
    if (id === myMapId) return 'You cannot vote for your own submission';
    return undefined;
  };

  const handleVoteAttempt = (id: string) => {
    if (!user) { setShowLoginModal(true); return; }
    onVote(id);
  };

  // The phase label comes from the same table the nav badge reads. This page used to
  // print "Voting Phase" whatever the round was doing, including with no round at all.
  const header = (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span
          className={`text-[10px] font-black tracking-widest font-mono uppercase ${
            round ? phaseConfig[round.phase].color : 'text-slate-500'
          }`}
        >
          {round ? phaseConfig[round.phase].label : 'No active round'}
        </span>
        {round && (
          <>
            <span className="text-slate-700">·</span>
            <span className="text-[10px] text-slate-500 font-mono">{roundLabel(round)}</span>
            <span className="text-slate-700">·</span>
            <span className="text-[10px] text-slate-500 font-mono">
              {frozen ? 'Voting closed' : `Ends in ${countdown}`}
            </span>
          </>
        )}
      </div>
      <h1 className="text-2xl font-black text-white mb-2 tracking-tight">Vote for the Monthly Challenge</h1>
      <p className="text-sm text-slate-400 max-w-2xl">
        {frozen
          ? 'The ballot is closed and these totals are final. Flip a card to see the challenge it was submitted with.'
          : "Eligible players get one vote. Flip a card to see challenges. The beatmap with the most votes becomes this month's challenge."}
      </p>
    </div>
  );

  // Before the phase gate on purpose: with the first fetch still in flight `round` is
  // null, and the gate would announce that no round is open rather than that nothing is
  // known yet. Without this the page also flashed "0 total votes" and an empty grid as
  // though those were the answer.
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8 pb-16">
        {header}
        <div className="flex items-center gap-3 py-20 justify-center text-slate-600">
          <span className="w-4 h-4 border-2 border-slate-700 border-t-slate-400 rounded-full animate-spin" />
          <span className="text-sm">Loading this round's entries…</span>
        </div>
      </div>
    );
  }

  // Outside the voting phase the page keeps its header and swaps the body, the way the
  // submit page does, so a reader still knows where they are.
  if (access.state !== 'open') {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8 pb-16">
        {header}
        <PhaseGate access={access} round={round} onNavigate={onNavigate} />
      </div>
    );
  }

  if (maps.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8 pb-16">
        {header}
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center">
            <Trophy className="w-7 h-7 text-slate-700" />
          </div>
          <div>
            <p className="text-white font-bold mb-1">Nothing to vote on yet</p>
            <p className="text-sm text-slate-500 max-w-md">
              No entry has been approved for this round. Approved beatmaps show up here as
              soon as an administrator lets one through.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 pb-16">
      {showLoginModal && (
        <LoginModal
          onClose={() => setShowLoginModal(false)}
          onLogin={() => { onLogin?.(); setShowLoginModal(false); }}
        />
      )}
      {header}

      {voteError && <VoteError text={voteError} onDismiss={onDismissVoteError} />}

      {frozen && round && (
        <BallotClosed
          round={round}
          winner={recordedWinner}
          tiedTitles={sorted.filter(tiedEntry).map((m) => m.title)}
        />
      )}

      {/* Stats + vote status */}
      <div className="flex items-center gap-4 mb-8 flex-wrap">
        <div className="flex items-center gap-4 bg-[#0d1526] border border-slate-800 rounded-xl px-5 py-3 flex-wrap gap-y-2">
          <div>
            <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Total votes</div>
            <div className="text-xl font-black font-mono text-white">{totalVotes.toLocaleString()}</div>
          </div>
          <div className="w-px h-8 bg-slate-800" />
          <div>
            <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Submissions</div>
            <div className="text-xl font-black font-mono text-white">{maps.length}</div>
          </div>
          <div className="w-px h-8 bg-slate-800" />
          <div className="flex items-center gap-2">
            {tied
              ? <Scale className="w-4 h-4 text-blue-400 flex-shrink-0" />
              : <Crown className="w-4 h-4 text-amber-400 flex-shrink-0" />}
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">
                {tied ? 'Tied at the top' : frozen ? 'Winner pending' : 'Leading'}
              </div>
              <div className={`text-sm font-black truncate max-w-40 ${tied ? 'text-blue-400' : 'text-amber-400'}`}>
                {tied
                  ? `${sorted.filter(tiedEntry).length} entries`
                  : frozen
                    ? recordedWinner?.title ?? 'not recorded'
                    : leader?.title}
              </div>
            </div>
          </div>
        </div>

        {votedMap ? (
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-4 py-2.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-xs font-black text-emerald-400">Vote cast</p>
              <p className="text-[10px] text-emerald-400/60 truncate max-w-[160px]">{votedMap.title}</p>
            </div>
          </div>
        ) : frozen ? (
          <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-2.5">
            <Ban className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <p className="text-xs font-bold text-slate-400">Voting is closed for this round.</p>
          </div>
        ) : user && !canVote ? (
          <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-2.5">
            <Ban className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <p className="text-xs font-bold text-slate-400">
              Your account cannot vote in this round.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-amber-400/8 border border-amber-400/20 rounded-xl px-4 py-2.5">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
            <p className="text-xs font-bold text-amber-400/80">Flip a card to vote</p>
          </div>
        )}
      </div>

      {/* Main layout — card grid + standings sidebar */}
      <div className="flex gap-7 items-start">

        {/* Card grid */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">All Submissions</h2>
            <span className="text-[10px] text-slate-600 font-mono">{maps.length} beatmaps</span>
          </div>

          {ownEntryListed && !frozen && (
            <p className="text-[11px] text-slate-600 -mt-2 mb-4">
              Your own entry is in this list and cannot be voted for.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            {visibleMaps.map((beatmap) => {
              const votes = (beatmap.voteCount ?? 0).toLocaleString();
              // The badge says what the round actually is: the live leader while the
              // ballot is open, and once it is closed either the recorded winner or the
              // entries level at the top. A tie crowns nobody.
              const badge: { tie: boolean; text: string } | null = !frozen
                ? beatmap.id === leader?.id
                  ? { tie: false, text: `Leading · ${votes} votes` }
                  : null
                : tied
                  ? tiedEntry(beatmap)
                    ? { tie: true, text: `Tied · ${votes} votes` }
                    : null
                  : beatmap.id === recordedWinnerId
                    ? { tie: false, text: 'Winner · pending approval' }
                    : null;
              return (
                <div key={beatmap.id} className="relative">
                  {badge && (
                    <div
                      className={`absolute -top-3 left-4 z-10 flex items-center gap-1.5 text-slate-950 text-[10px] font-black px-3 py-0.5 rounded-full uppercase tracking-wider shadow-lg ${
                        badge.tie ? 'bg-blue-400 shadow-blue-400/25' : 'bg-amber-400 shadow-amber-400/25'
                      }`}
                    >
                      {badge.tie ? <Scale className="w-3 h-3" /> : <Crown className="w-3 h-3" />}
                      {badge.text}
                    </div>
                  )}
                  <BeatmapCard
                    beatmap={{ ...beatmap, comments: comments.get(Number(beatmap.id)) ?? [] }}
                    isPlaying={playingId === beatmap.id}
                    audioProgress={audioProgress(beatmap.id)}
                    onTogglePlay={() => onTogglePlay(beatmap.id)}
                    onScrubAudio={(e) => onScrub(beatmap.id, e)}
                    onVote={() => handleVoteAttempt(beatmap.id)}
                    onFavorite={() => onFavorite(beatmap)}
                    onAddComment={(body, parentId) => addComment(beatmap, body, parentId)}
                    canComment={user !== null}
                    voteBusy={voteBusy === beatmap.id}
                    voteDisabled={refusal(beatmap.id) !== undefined}
                    voteDisabledReason={refusal(beatmap.id)}
                    showVoteButton={!frozen}
                  />
                </div>
              );
            })}
          </div>

          {sorted.length > 6 && !showAll && (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="flex items-center gap-2 mx-auto px-6 py-2.5 bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition-all"
              >
                Show all {sorted.length} submissions
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Standings sidebar */}
        <aside className="hidden lg:block w-72 flex-shrink-0 sticky top-24">
          <VoteStandings maps={maps} votedId={votedMap?.id ?? null} final={frozen} tiedTop={tied} />
          {!user && !frozen && (
            <div className="mt-4 bg-[#0d1526] border border-slate-800 rounded-2xl px-4 py-4 text-center">
              <p className="text-xs text-slate-500 leading-relaxed">
                Log in with your osu! account to cast your vote.
              </p>
              <button
                type="button"
                onClick={() => setShowLoginModal(true)}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black rounded-xl transition-all"
              >
                <LogIn className="w-3.5 h-3.5" />
                Login with osu!
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
