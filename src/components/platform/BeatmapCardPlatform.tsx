import React, { useEffect, useRef, useState } from 'react';
import { Beatmap } from '../../types';
import { Star, Heart, CheckCircle2, Music2, Upload, Play, Pause } from 'lucide-react';

const statusConfig = {
  ranked:   { bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/30', label: 'Ranked'   },
  loved:    { bg: 'bg-rose-500/20',    text: 'text-rose-300',    border: 'border-rose-500/30',    label: 'Loved'    },
  approved: { bg: 'bg-sky-500/20',     text: 'text-sky-300',     border: 'border-sky-500/30',     label: 'Approved' },
};

interface BeatmapCardPlatformProps {
  beatmap: Beatmap;
  showVoteButton?: boolean;
  showSubmitButton?: boolean;
  voted?: boolean;
  onVote?: () => void;
  onFavorite?: () => void;
  onSubmit?: () => void;
  /**
   * Denominator for the vote bar — the leader's count, normally. Omit it and only
   * the raw count shows: it used to default to 47, which printed a meaningless
   * "0 / 47" on the dashboard and submit pages, where nothing is being voted on.
   */
  maxVotes?: number;
  /** A cast or retract for this card is in flight. */
  voteBusy?: boolean;
  /** This card may not be voted for at all — a self-vote, or voting is closed. */
  voteDisabled?: boolean;
  voteDisabledReason?: string;
}

export function BeatmapCardPlatform({
  beatmap,
  showVoteButton,
  showSubmitButton,
  voted,
  onVote,
  onFavorite,
  onSubmit,
  maxVotes,
  voteBusy,
  voteDisabled,
  voteDisabledReason,
}: BeatmapCardPlatformProps) {
  // Read from the beatmap, never held locally. A4 moved favorites to the server, and a
  // local copy was the reason a heart filled in and then came back empty on reload — the
  // card was reporting its own optimism rather than what was stored.
  const favorited = beatmap.isFavorited ?? false;
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isVoted = voted ?? beatmap.isVoted ?? false;
  const status = statusConfig[beatmap.status];
  const votePercent =
    beatmap.voteCount !== undefined && maxVotes !== undefined && maxVotes > 0
      ? Math.min(100, Math.round((beatmap.voteCount / maxVotes) * 100))
      : 0;
  const voteBlocked = Boolean(voteBusy || voteDisabled);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!beatmap.previewUrl) return;
    if (!audioRef.current) {
      const audio = new Audio(beatmap.previewUrl);
      audio.ontimeupdate = () => {
        const a = audioRef.current;
        if (a && a.duration) setProgress(a.currentTime / a.duration);
      };
      audio.onended = () => {
        setIsPlaying(false);
        setProgress(0);
      };
      audioRef.current = audio;
    }
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  };

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  };

  const handleFavorite = () => {
    onFavorite?.();
  };

  return (
    <div className="group relative bg-[#0d1526] border border-slate-800/80 rounded-2xl overflow-hidden hover:border-slate-700/80 hover:shadow-lg hover:shadow-black/30 transition-all duration-300">

      {/* Cover image */}
      <div className="relative h-36 overflow-hidden bg-slate-900/80">
        <img
          src={beatmap.coverUrl}
          alt={beatmap.title}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-70 group-hover:opacity-90 group-hover:scale-[1.03] transition-all duration-500"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0d1526] via-[#0d1526]/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0d1526]/40 to-transparent" />

        {/* Status badge */}
        <span className={`absolute top-3 left-3 text-[10px] font-black px-2.5 py-1 rounded-lg border backdrop-blur-sm ${status.bg} ${status.text} ${status.border}`}>
          {status.label}
        </span>

        {/* Star rating */}
        <div className="absolute top-3 right-3 flex items-center gap-1 bg-slate-950/70 backdrop-blur-sm px-2 py-1 rounded-lg">
          <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />
          <span className="text-[11px] font-black font-mono text-amber-400">{beatmap.stars.toFixed(2)}</span>
        </div>

        {/* Title overlay at bottom of cover */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-3">
          <h3 className="text-sm font-black text-white leading-tight line-clamp-1 drop-shadow-md tracking-tight">
            {beatmap.title}
          </h3>
          <p className="text-[11px] text-slate-300/80 line-clamp-1 mt-0.5">{beatmap.artist}</p>
        </div>

        {/* Favorite button on cover */}
        <button
          type="button"
          onClick={handleFavorite}
          aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
          className={`absolute bottom-3 right-3 p-1.5 rounded-lg backdrop-blur-sm transition-all ${
            favorited
              ? 'bg-rose-500/30 text-rose-400 border border-rose-500/40'
              : 'bg-slate-950/50 text-slate-500 hover:text-rose-400 border border-slate-700/40'
          }`}
        >
          <Heart className={`w-3.5 h-3.5 ${favorited ? 'fill-rose-400' : ''}`} />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 pt-3 pb-4 space-y-3">

        {/* Mapper + diff */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            by <span className="text-slate-300 font-semibold">{beatmap.mapper}</span>
          </p>
          <span className="text-[10px] bg-slate-900 border border-slate-700/60 px-2 py-0.5 rounded-full text-slate-400 font-medium truncate max-w-[120px]">
            {beatmap.difficultyName}
          </span>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500">
          <span className="flex items-center gap-1">
            <Music2 className="w-3 h-3" />
            {beatmap.bpm} BPM
          </span>
          <span className="text-slate-800">·</span>
          <span>{beatmap.length}</span>
          {beatmap.submittedByName && (
            <>
              <span className="text-slate-800">·</span>
              <span className="text-slate-600 truncate">by {beatmap.submittedByName}</span>
            </>
          )}
        </div>

        {/* Audio preview player */}
        <div className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 border transition-all ${
          isPlaying
            ? 'bg-amber-400/8 border-amber-400/25'
            : 'bg-slate-900/60 border-slate-800/60'
        }`}>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            disabled={!beatmap.previewUrl}
            className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
              isPlaying
                ? 'bg-amber-400 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {isPlaying
              ? <Pause className="w-3 h-3 fill-current" />
              : <Play className="w-3 h-3 fill-current ml-0.5" />
            }
          </button>
          <div
            onClick={handleScrub}
            className="flex-1 h-1.5 bg-slate-800 rounded-full relative overflow-hidden cursor-pointer"
          >
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-all ${isPlaying ? 'bg-amber-400' : 'bg-slate-600'}`}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-600 font-mono flex-shrink-0 w-14 text-right">
            {isPlaying ? 'preview' : 'preview'}
          </span>
        </div>

        {/* Challenge chips */}
        {(beatmap.modRequirement || beatmap.challengeType) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {beatmap.modRequirement && (
              <span className="text-[10px] font-mono font-bold bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 px-2 py-0.5 rounded-lg">
                {beatmap.modRequirement}
              </span>
            )}
            {beatmap.challengeType && (
              <span className="text-[10px] font-bold bg-amber-400/8 border border-amber-400/20 text-amber-400/90 px-2 py-0.5 rounded-lg">
                {beatmap.challengeType}
              </span>
            )}
          </div>
        )}

        {/* Vote progress */}
        {beatmap.voteCount !== undefined && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-600 font-mono">Votes</span>
              <span className="text-[11px] font-black font-mono text-white">{beatmap.voteCount}
                {maxVotes !== undefined && (
                  <span className="text-slate-600 font-normal"> / {maxVotes}</span>
                )}
              </span>
            </div>
            {maxVotes !== undefined && (
              <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${isVoted ? 'bg-emerald-400' : 'bg-amber-400/60'}`}
                  style={{ width: `${votePercent}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {(showVoteButton || showSubmitButton) && (
          <div className="flex items-center gap-2 pt-0.5">
            {showVoteButton && (
              <div className="flex-1 space-y-1">
                <button
                  type="button"
                  disabled={voteBlocked}
                  title={voteDisabled ? voteDisabledReason : undefined}
                  aria-label={voteDisabled && voteDisabledReason ? voteDisabledReason : undefined}
                  onClick={voteBlocked ? undefined : onVote}
                  className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-black transition-all active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed ${
                    isVoted
                      ? 'bg-emerald-600/80 hover:bg-emerald-500/80 text-white border border-emerald-500/30'
                      : 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                  }`}
                >
                  {isVoted && !voteBusy && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {voteBusy ? 'Voting…' : isVoted ? 'Voted' : 'Vote for this'}
                </button>
                {voteDisabled && voteDisabledReason && (
                  <p className="text-[10px] text-slate-500 text-center leading-snug">
                    {voteDisabledReason}
                  </p>
                )}
              </div>
            )}
            {showSubmitButton && (
              <button
                type="button"
                onClick={onSubmit}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-black bg-amber-400 hover:bg-amber-300 text-slate-950 transition-all active:scale-[0.97]"
              >
                <Upload className="w-3.5 h-3.5" />
                Submit this
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
