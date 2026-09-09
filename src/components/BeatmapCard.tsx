import React, { useRef, useState } from 'react';
import { Beatmap, BeatmapComment } from '../types';
import {
  Star, Play, Pause, MessageSquare, Heart,
  CheckCircle2, Trophy, Crown, Target, Flame, Medal,
  CornerDownRight, Send, X,
} from 'lucide-react';

// ── DZPP qualification point constants (mirrors server/src/repo/dzpp.ts) ─────
// Imported as literals so the card has no server dependency. If the server
// constants change a new formula version is cut anyway, so these travel with it.
const MOD_COMPLIANCE_POINTS = 10;
const REQUIREMENT_ACHIEVEMENT_POINTS = 15;

// ── Star colour scheme (6 bands, from the new design) ────────────────────────
function starColorScheme(rating: number): { header: string; fill: string } {
  if (rating < 2.0) return { header: 'bg-lime-500 text-slate-950',   fill: 'bg-lime-400' };
  if (rating < 2.7) return { header: 'bg-sky-500 text-slate-950',    fill: 'bg-sky-400' };
  if (rating < 4.0) return { header: 'bg-amber-400 text-slate-950',  fill: 'bg-amber-400' };
  if (rating < 5.3) return { header: 'bg-rose-500 text-white',       fill: 'bg-rose-400' };
  if (rating < 6.5) return { header: 'bg-purple-600 text-white',     fill: 'bg-purple-400' };
  return                    { header: 'bg-gray-900 text-white',       fill: 'bg-gray-300' };
}

// ── Fractional star row (from the new design) ─────────────────────────────────
function StarRow({ rating }: { rating: number }) {
  const total = Math.max(1, Math.ceil(rating));
  const fraction = rating % 1 || 1;
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: total }).map((_, i) => {
        const pct = i < total - 1 ? 100 : Math.round(fraction * 100);
        return (
          <span key={i} className="relative w-3.5 h-3.5 flex-shrink-0 inline-block">
            <Star className="absolute inset-0 w-3.5 h-3.5 opacity-25 fill-current stroke-current" />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
              <Star className="w-3.5 h-3.5 fill-current stroke-current" />
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ── Challenge type → visual style + icon ─────────────────────────────────────
const CHALLENGE_STYLES: Record<string, {
  bg: string; border: string; text: string; badge: string; icon: React.ReactNode;
}> = {
  'Full Combo': {
    bg: 'bg-yellow-900/40', border: 'border-yellow-500/60',
    text: 'text-yellow-400', badge: 'bg-yellow-800/60',
    icon: <Trophy className="w-4 h-4" />,
  },
  'Top #1 Score': {
    bg: 'bg-cyan-900/40', border: 'border-cyan-500/60',
    text: 'text-cyan-400', badge: 'bg-cyan-800/60',
    icon: <Crown className="w-4 h-4" />,
  },
  'Best Accuracy': {
    bg: 'bg-slate-700/40', border: 'border-slate-500/60',
    text: 'text-slate-300', badge: 'bg-slate-700/60',
    icon: <Target className="w-4 h-4" />,
  },
  'Lowest Miss Count': {
    bg: 'bg-amber-900/40', border: 'border-amber-700/60',
    text: 'text-amber-400', badge: 'bg-amber-800/60',
    icon: <Flame className="w-4 h-4" />,
  },
};

const FALLBACK_CHALLENGE_STYLE = {
  bg: 'bg-slate-800/40', border: 'border-slate-600/60',
  text: 'text-slate-300', badge: 'bg-slate-700/60',
  icon: <Medal className="w-4 h-4" />,
};

const ratingColors = [
  'text-rose-400', 'text-amber-400', 'text-yellow-300', 'text-emerald-400', 'text-cyan-400',
];

interface BeatmapCardProps {
  beatmap: Beatmap;
  isPlaying: boolean;
  audioProgress: number;
  onTogglePlay: () => void;
  onScrubAudio: (e: React.MouseEvent<HTMLDivElement>) => void;
  onVote: () => void;
  onFavorite: () => void;
  /**
   * Posts a comment, or a reply when a parent id is given (B8). Resolves to an error message,
   * or null on success.
   *
   * The card does NOT keep the result. It used to hold localComments, which is why a comment
   * looked posted and was gone on reload; the list now arrives on beatmap.comments and the
   * page that owns the fetch re-reads after a successful write.
   */
  onAddComment?: (body: string, parentId?: string) => Promise<string | null>;
  /** Whether the caller can comment at all — commenting needs a session, not eligibility. */
  canComment?: boolean;
  /** A cast or retract for this card is in flight. */
  voteBusy?: boolean;
  /** This card may not be voted for at all — a self-vote, or voting is closed. */
  voteDisabled?: boolean;
  /** Why, for the button's title and aria-label. The page states it in prose too. */
  voteDisabledReason?: string;
  /**
   * Whether to render a vote button at all. Defaults to true. False turns the card
   * read-only on both faces — for a closed ballot, where a permanently greyed-out
   * button is just a dead control on a results page.
   */
  showVoteButton?: boolean;
}

export const BeatmapCard: React.FC<BeatmapCardProps> = ({
  beatmap, isPlaying, audioProgress,
  onTogglePlay, onScrubAudio, onVote, onFavorite,
  onAddComment, canComment = false,
  voteBusy, voteDisabled, voteDisabledReason, showVoteButton = true,
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [spinClass, setSpinClass] = useState('');
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  // From the server, through the page that fetched it. Never a local copy — that was the bug.
  const localComments: BeatmapComment[] = beatmap.comments ?? [];
  // Top-level comments only; replies are rendered nested under their parent.
  const topLevel = localComments.filter((c) => !c.parentId);
  const spinRef = useRef<(() => void) | null>(null);

  const { header: headerBgClass, fill: barFillColor } = starColorScheme(beatmap.stars);

  const challengeStyle =
    (beatmap.challengeType ? CHALLENGE_STYLES[beatmap.challengeType] : undefined)
    ?? FALLBACK_CHALLENGE_STYLE;

  const formatTime = (ratio: number, total: number) => {
    const s = Math.floor(ratio * total);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // One spin at a time. The callback runs on animationend, ~600ms after the click,
  // so without this guard a double-click would queue a second vote behind the first.
  const triggerSpin = (callback: () => void) => {
    if (spinRef.current) return;
    spinRef.current = callback;
    setSpinClass('spinning');
  };

  const voteBlocked = Boolean(voteBusy || voteDisabled);
  const voteTitle = voteDisabled ? voteDisabledReason : undefined;

  const handleAnimationEnd = () => {
    spinRef.current?.();
    spinRef.current = null;
    setSpinClass('');
  };

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-scrub]') || target.closest('input') || target.closest('textarea')) return;
    setIsFlipped((f) => !f);
  };

  const handleSubmitComment = async () => {
    const text = newComment.trim();
    if (!text || !onAddComment) return;
    setCommentBusy(true);
    const error = await onAddComment(text);
    setCommentBusy(false);
    if (error !== null) {
      setCommentError(error);
      return;
    }
    setCommentError(null);
    setNewComment('');
  };

  const handleSubmitReply = async (parentId: string) => {
    const text = replyText.trim();
    if (!text || !onAddComment) return;
    setCommentBusy(true);
    // The "@name" prefix is gone: the reply is threaded under its parent by parent_id now, so
    // repeating the name in the body was decoration that also ended up stored forever.
    const error = await onAddComment(text, parentId);
    setCommentBusy(false);
    if (error !== null) {
      setCommentError(error);
      return;
    }
    setCommentError(null);
    setReplyText('');
    setReplyingTo(null);
  };

  const innerClass = `card-inner ${isFlipped ? 'flipped' : ''} ${spinClass}`;

  return (
    <div className="card-scene w-full" style={{ height: '540px' }}>
      <div
        className={innerClass}
        onAnimationEnd={handleAnimationEnd}
        onClick={handleCardClick}
        style={{ cursor: 'pointer' }}
      >
        {/* ── FRONT FACE ── */}
        <div className="card-face bg-[#0f172a] border border-slate-700/80 rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:border-slate-500/90 transition-shadow duration-300 flex flex-col text-slate-100 group">

          {/* Star Rating Banner — fractional StarRow + 6-band colour scheme */}
          <div className={`w-full py-1 px-3 flex items-center justify-between font-bold text-xs tracking-wider select-none flex-shrink-0 ${headerBgClass}`}>
            <StarRow rating={beatmap.stars} />
            <span className="font-mono font-black text-sm tracking-tight">{beatmap.stars.toFixed(2)}</span>
          </div>

          {/* Cover Artwork */}
          <div className="relative h-28 w-full bg-slate-900 overflow-hidden flex-shrink-0">
            <img
              src={beatmap.coverUrl}
              alt={beatmap.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/20 to-transparent" />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); triggerSpin(onFavorite); }}
              aria-label="Favorite"
              className={`absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-md transition-colors ${
                beatmap.isFavorited
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/60'
                  : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-700/60'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${beatmap.isFavorited ? 'fill-rose-500 text-rose-500' : ''}`} />
            </button>
            <div className="absolute bottom-2 right-2.5 bg-slate-950/85 backdrop-blur-md px-2 py-0.5 rounded-md border border-slate-700/80 flex items-center gap-1.5 text-[11px]">
              <span className="font-bold text-white font-mono">{(beatmap.voteCount ?? 0).toLocaleString()}</span>
              <span className="text-slate-400 text-[10px]">votes</span>
            </div>
          </div>

          {/* Info */}
          <div className="px-4 pt-3 flex-shrink-0">
            <h3 className="text-sm font-bold text-white tracking-tight line-clamp-1 group-hover:text-amber-400 transition-colors">
              {beatmap.title}
            </h3>
            <p className="text-[11px] text-slate-300 font-medium mt-0.5">{beatmap.artist}
              <span className="text-slate-500 font-normal"> · mapped by </span>
              <span className="text-slate-200 font-semibold">{beatmap.mapper}</span>
            </p>
            <div className="mt-1.5 mb-2">
              <span className="inline-block bg-slate-800/90 text-slate-200 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-slate-700">
                {beatmap.difficultyName}
              </span>
            </div>
          </div>

          {/* ── ANIMATED PANEL SWITCHER ── */}
          <div className="flex-1 overflow-hidden relative px-4">
            {/* Specs panel */}
            <div
              className="absolute inset-x-4 top-0"
              style={{
                opacity: showComments ? 0 : 1,
                transform: showComments ? 'translateY(-12px)' : 'translateY(0)',
                transition: 'opacity 0.28s ease, transform 0.28s ease',
                pointerEvents: showComments ? 'none' : 'auto',
              }}
            >
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 mb-3 space-y-2">
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Length</span>
                    <span className="text-slate-100 font-bold font-mono">{beatmap.length}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">BPM</span>
                    <span className="text-slate-100 font-bold font-mono">{beatmap.bpm}</span>
                  </div>
                </div>
                {[
                  { label: 'Circle Size', value: beatmap.cs ?? 0, max: 7 },
                  { label: 'Approach Rate', value: beatmap.ar ?? 0, max: 10 },
                  { label: 'Accuracy', value: beatmap.od ?? 0, max: 10 },
                  { label: 'HP Drain', value: beatmap.hp ?? 0, max: 10 },
                ].map(({ label, value, max }) => (
                  <div key={label} className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">{label}</span>
                      <span className="text-slate-200 font-bold font-mono">{value.toFixed(1)}</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barFillColor}`}
                        style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Audio Player */}
              <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-2.5 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onTogglePlay(); }}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                    isPlaying ? 'bg-amber-400 text-slate-950 scale-105' : 'bg-slate-800 text-white hover:bg-slate-700'
                  }`}
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                </button>
                <div
                  data-scrub="true"
                  onClick={(e) => { e.stopPropagation(); onScrubAudio(e); }}
                  className="flex-1 h-2 bg-slate-800 rounded-full relative overflow-hidden cursor-pointer"
                >
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all ${isPlaying ? 'bg-amber-400' : 'bg-slate-400'}`}
                    style={{ width: `${Math.round(audioProgress * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 tabular-nums font-mono w-12 text-right">
                  {formatTime(audioProgress, beatmap.previewSeconds || 60)}
                </span>
              </div>
            </div>

            {/* Comments panel */}
            <div
              className="absolute inset-x-0 top-0 flex flex-col h-full"
              style={{
                opacity: showComments ? 1 : 0,
                transform: showComments ? 'translateY(0)' : 'translateY(12px)',
                transition: 'opacity 0.28s ease, transform 0.28s ease',
                pointerEvents: showComments ? 'auto' : 'none',
              }}
            >
              <div className="flex items-center justify-between mb-2 px-0">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                  {localComments.length} comment{localComments.length !== 1 ? 's' : ''}
                </span>
                {/* Anyone signed in may comment, whatever their country: my_plan.txt grants
                    discussion to players who cannot vote, so this deliberately does not
                    mention eligibility. */}
                {!canComment && (
                  <span className="text-[10px] text-slate-600">Log in to join the discussion</span>
                )}
              </div>
              {commentError && (
                <p className="text-[10px] text-rose-400/90 mb-1.5">{commentError}</p>
              )}

              {/* Comment list — top-level with replies nested underneath */}
              <div className="flex-1 overflow-y-auto space-y-2 pb-2 pr-0.5" style={{ scrollbarWidth: 'thin' }}>
                {localComments.length === 0 && (
                  <p className="text-xs text-slate-600 text-center py-4">No comments yet. Be the first!</p>
                )}
                {topLevel.map((c) => {
                  const replies = localComments.filter((r) => r.parentId === c.id);
                  return (
                    <div key={c.id}>
                      {/* Top-level comment */}
                      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5">
                            {/* Avatar: real image with letter-circle fallback */}
                            {c.avatar ? (
                              <img
                                src={c.avatar}
                                alt={c.user}
                                referrerPolicy="no-referrer"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                className="w-5 h-5 rounded-full object-cover flex-shrink-0 border border-slate-600"
                              />
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-[9px] font-bold text-slate-300 uppercase flex-shrink-0">
                                {c.user[0]}
                              </div>
                            )}
                            <span className="text-[11px] font-bold text-slate-200">{c.user}</span>
                            <span className="text-[10px] text-slate-600">{c.time}</span>
                          </div>
                          {c.rating != null && (
                            <span className={`text-[10px] font-mono font-bold ${ratingColors[(c.rating - 1) % ratingColors.length]}`}>
                              ★{c.rating}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-300 leading-snug">{c.text}</p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReplyingTo(replyingTo === c.id ? null : c.id);
                            setReplyText('');
                          }}
                          className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500 hover:text-amber-400 transition-colors"
                        >
                          <CornerDownRight className="w-3 h-3" />
                          Reply
                        </button>

                        {/* Inline reply input */}
                        {replyingTo === c.id && (
                          <div
                            className="mt-2 flex gap-1.5 pl-3 border-l-2 border-slate-700"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              autoFocus
                              type="text"
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmitReply(c.id); }}
                              placeholder={`Reply to ${c.user}…`}
                              className="flex-1 bg-slate-950/60 border border-slate-800 rounded-md px-2 py-1 text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-slate-600"
                            />
                            <button
                              type="button"
                              onClick={() => void handleSubmitReply(c.id)}
                              disabled={commentBusy}
                              className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                            >
                              <Send className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Nested replies — indented with a left border */}
                      {replies.length > 0 && (
                        <div className="ml-3 mt-1 pl-2.5 border-l-2 border-slate-700/50 space-y-1">
                          {replies.map((r) => (
                            <div key={r.id} className="bg-slate-900/50 border border-slate-800/60 rounded-lg p-2">
                              <div className="flex items-center gap-1.5 mb-1">
                                {r.avatar ? (
                                  <img
                                    src={r.avatar}
                                    alt={r.user}
                                    referrerPolicy="no-referrer"
                                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                    className="w-4 h-4 rounded-full object-cover flex-shrink-0 border border-slate-600"
                                  />
                                ) : (
                                  <div className="w-4 h-4 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-[8px] font-bold text-slate-400 uppercase flex-shrink-0">
                                    {r.user[0]}
                                  </div>
                                )}
                                <span className="text-[10px] font-bold text-slate-300">{r.user}</span>
                                <span className="text-[9px] text-slate-600">{r.time}</span>
                              </div>
                              <p className="text-[10px] text-slate-400 leading-snug">{r.text}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* New comment input */}
              <div
                className="mt-2 flex gap-1.5 flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmitComment(); }}
                  disabled={!canComment || commentBusy}
                  placeholder={canComment ? 'Add a comment…' : 'Log in to comment'}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-400/60 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => void handleSubmitComment()}
                  disabled={!canComment || commentBusy}
                  className="px-2.5 rounded-xl bg-amber-400 text-slate-950 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-auto pt-3 px-4 pb-4 border-t border-slate-800 flex items-center gap-2 flex-shrink-0">
            {showVoteButton && (
            <button
              type="button"
              disabled={voteBlocked}
              title={voteTitle}
              aria-label={voteTitle}
              onClick={(e) => {
                e.stopPropagation();
                if (voteBlocked) return;
                triggerSpin(onVote);
              }}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed ${
                beatmap.isVoted
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold'
              }`}
            >
              {voteBusy
                ? <span>Voting…</span>
                : beatmap.isVoted
                  ? <><CheckCircle2 className="w-3.5 h-3.5" /><span>Voted</span></>
                  : <span>Vote</span>}
            </button>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                // The panel used to notify the page it had opened, for a lazy load that
                // never existed; the round's whole discussion arrives with the page now (B8).
                setShowComments((v) => !v);
              }}
              className={`px-2.5 py-2 rounded-lg border text-xs font-semibold transition-all flex items-center gap-1.5 ${
                showComments
                  ? 'bg-amber-400/20 border-amber-400/60 text-amber-400'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
              title="Toggle comments"
            >
              {showComments
                ? <X className="w-3.5 h-3.5" />
                : <MessageSquare className="w-3.5 h-3.5 text-slate-400" />}
              {!showComments && localComments.length > 0 && (
                <span className="text-[10px] bg-slate-900 px-1.5 py-0.5 rounded-full font-bold">{localComments.length}</span>
              )}
            </button>
          </div>
        </div>

        {/* ── BACK FACE ── */}
<div className="card-face card-face-back bg-[#0f172a] border border-slate-700/80 rounded-2xl overflow-hidden shadow-lg flex flex-col text-slate-100">

  {/* Header */}
  <div className={`w-full py-2 px-3 flex items-center justify-between font-bold text-xs tracking-wider select-none flex-shrink-0 ${headerBgClass}`}>
    <span className="font-mono font-black">CHALLENGE REQUIREMENTS</span>
    <Trophy className="w-4 h-4" />
  </div>

  {/* Map preview */}
  <div className="relative h-20 overflow-hidden flex-shrink-0">
    <img
      src={beatmap.coverUrl}
      alt=""
      referrerPolicy="no-referrer"
      className="w-full h-full object-cover opacity-40"
    />

    <div className="absolute inset-0 bg-gradient-to-r from-[#0f172a]/95 via-[#0f172a]/70 to-[#0f172a]/95" />

    <div className="absolute inset-0 px-3 py-2.5 flex flex-col justify-center gap-0.5">
      <p className="text-sm font-black text-white line-clamp-2 leading-tight">
        {beatmap.title}
      </p>

      <p className="text-[11px] text-slate-300 truncate">
        {beatmap.artist}
        <span className="text-slate-500"> · mapped by </span>
        {beatmap.mapper}
      </p>

      <p className="text-[10px] text-amber-400 font-mono font-bold">
        ★ {beatmap.stars.toFixed(2)} · {beatmap.difficultyName}
      </p>
    </div>
  </div>

  {/* Main content */}
  <div className="flex-1 overflow-y-auto p-3 space-y-2.5">

    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">
      Challenge requirement
    </p>

    {/* Challenge requirement card */}
    {beatmap.challengeType ? (
      <div className={`rounded-xl border p-3 ${challengeStyle.bg} ${challengeStyle.border}`}>

        <div className="flex items-start gap-2.5">

          {/* Icon */}
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${challengeStyle.badge} ${challengeStyle.text}`}
          >
            {challengeStyle.icon}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">

            {/* Requirement + mod */}
            <div className="flex items-center justify-between gap-2 mb-1">

              <p className={`text-xs font-bold ${challengeStyle.text} leading-tight`}>
                {beatmap.challengeType}
              </p>

              {beatmap.modRequirement && (
                <span
                  className={`text-[10px] font-mono font-black px-1.5 py-0.5 rounded-md ${challengeStyle.badge} ${challengeStyle.text} flex-shrink-0`}
                >
                  {beatmap.modRequirement}
                </span>
              )}

            </div>

            {/* DZPP points */}
            <div className="mt-2 space-y-1">

              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">
                  Mod compliance
                </span>

                <span className="font-mono font-bold text-slate-200">
                  +{MOD_COMPLIANCE_POINTS} pts
                </span>
              </div>

              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">
                  Requirement achievement
                </span>

                <span className="font-mono font-bold text-slate-200">
                  +{REQUIREMENT_ACHIEVEMENT_POINTS} pts
                </span>
              </div>

              <div className={`flex items-center justify-between text-[10px] pt-1 border-t border-slate-700/60`}>
                <span className={`font-bold ${challengeStyle.text}`}>
                  Max qualification
                </span>

                <span className={`font-mono font-black ${challengeStyle.text}`}>
                  +{MOD_COMPLIANCE_POINTS + REQUIREMENT_ACHIEVEMENT_POINTS} pts
                </span>
              </div>

            </div>

          </div>
        </div>
      </div>
    ) : (
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl px-3 py-2.5">
        <span className="text-[11px] text-slate-600">
          No challenge requirement set
        </span>
      </div>
    )}

    {/* Submission metadata */}
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl divide-y divide-slate-800/60">

      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <span className="text-[11px] text-slate-500">
          Submitted by
        </span>

        <span className="text-[11px] font-bold text-slate-100 text-right">
          {beatmap.submittedByName || '—'}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <span className="text-[11px] text-slate-500">
          Map status
        </span>

        <span className="text-[11px] font-bold text-slate-100 text-right">
          {beatmap.status || '—'}
        </span>
      </div>

    </div>

    {beatmap.description && (
      <p className="text-[11px] text-slate-400 leading-snug px-1">
        {beatmap.description}
      </p>
    )}

  </div>

  {/* Actions */}
  <div className="p-3 border-t border-slate-800 flex gap-2 flex-shrink-0">

    {showVoteButton && (
      <button
        type="button"
        disabled={voteBlocked}
        title={voteTitle}
        aria-label={voteTitle}
        onClick={(e) => {
          e.stopPropagation();
          if (voteBlocked) return;
          triggerSpin(onVote);
        }}
        className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed ${
          beatmap.isVoted
            ? 'bg-emerald-600 text-white'
            : 'bg-amber-400 hover:bg-amber-300 text-slate-950'
        }`}
      >
        {voteBusy
          ? 'Voting…'
          : beatmap.isVoted
            ? <><CheckCircle2 className="w-3.5 h-3.5" /> Voted</>
            : 'Vote'}
      </button>
    )}

    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        triggerSpin(onFavorite);
      }}
      className={`px-3 py-2 rounded-lg border text-xs font-bold transition-colors ${
        beatmap.isFavorited
          ? 'bg-rose-500/20 border-rose-500/60 text-rose-400'
          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
      }`}
    >
      <Heart className={`w-3.5 h-3.5 ${beatmap.isFavorited ? 'fill-rose-500' : ''}`} />
    </button>

  </div>

</div>
      </div>
    </div>
  );
};
