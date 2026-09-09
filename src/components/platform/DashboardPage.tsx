import React, { useState } from 'react';
import { Beatmap, Phase, PlatformPage } from '../../types';
import { ApiChallengeScore, ApiSubmission } from '../../api/client';
import { CurrentRound, formatDeadline, isBallotOpen, roundLabel, useCountdown } from '../../lib/round';
import { beatmapUrl, REVIEW_PRESENTATION, toBeatmap } from '../../lib/submission';
import { BeatmapCardPlatform } from './BeatmapCardPlatform';
import { WithdrawButton } from './WithdrawButton';
import { AuthUser } from './NavHeader';
import { ChallengeChat } from './ChallengeChat';
import {
  Trophy, Crown, Upload, ChevronRight, RefreshCw,
  CheckCircle2, AlertCircle, Clock, LogIn, X, Ban, Heart, Info, Link as LinkIcon,
} from 'lucide-react';

// ── INLINE LOGIN NUDGE ────────────────────────────────────────────────────────

function LoginNudge({ message, onLogin }: { message: string; onLogin?: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex items-center gap-3 bg-amber-400/8 border border-amber-400/20 rounded-xl px-4 py-3 mb-6">
      <LogIn className="w-4 h-4 text-amber-400 flex-shrink-0" />
      <p className="text-xs text-amber-400/80 flex-1">{message}</p>
      <button
        type="button"
        onClick={onLogin}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-[11px] font-black rounded-lg transition-all flex-shrink-0"
      >
        Login with osu!
      </button>
      <button type="button" onClick={() => setDismissed(true)} className="text-slate-600 hover:text-slate-400 transition-colors flex-shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── ROUND HEADER ─────────────────────────────────────────────────────────────

const roundMeta: Record<Phase, { label: string; color: string; bar: string; desc: string }> = {
  submission: {
    label: 'SUBMISSION PHASE',
    color: 'text-amber-400',
    bar: 'bg-amber-400',
    desc: 'Submit the beatmap you want as this month\'s community challenge. The community votes to decide the winner.',
  },
  voting: {
    label: 'VOTING PHASE',
    color: 'text-blue-400',
    bar: 'bg-blue-500',
    desc: 'Cast your vote for the beatmap you want as the monthly challenge. Eligible players get one vote each.',
  },
  challenge: {
    label: 'CHALLENGE PHASE',
    color: 'text-purple-400',
    bar: 'bg-purple-500',
    desc: 'The winning beatmap has been chosen. Submit your best score to qualify and compete for the monthly bounty.',
  },
};

function RoundHeader({ round, countdown }: { round: CurrentRound; countdown: string }) {
  const cfg = roundMeta[round.phase];
  // Same rule as the nav badge and the vote page: a closed ballot has nothing left to
  // count down to, and the phase alone cannot tell you the ballot is closed.
  const frozen = round.phase === 'voting' && !isBallotOpen(round);

  return (
    <div className="mb-10">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className={`text-[10px] font-black tracking-widest uppercase font-mono ${cfg.color}`}>
              {cfg.label}
            </span>
            <span className="text-slate-700">·</span>
            <span className="text-[10px] text-slate-500 font-mono">{roundLabel(round)}</span>
            {/* The bounty is the challenge prize, so it belongs where the round is
                introduced rather than only on the challenge hero — a player deciding
                whether to enter is the one who wants to know it. */}
            {round.reward && (
              <>
                <span className="text-slate-700">·</span>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-400/90">
                  <Trophy className="w-3 h-3" />
                  {round.reward}
                </span>
              </>
            )}
          </div>
          <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">{cfg.desc}</p>
        </div>
        <div className="flex-shrink-0">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 text-right">
            {frozen ? 'Ballot' : 'Ends in'}
          </div>
          <div className={`text-2xl font-black font-mono ${frozen ? 'text-slate-400' : cfg.color}`}>
            {frozen ? 'closed' : countdown}
          </div>
        </div>
      </div>
      <div className={`mt-5 h-px w-full ${cfg.bar} opacity-20 rounded-full`} />
    </div>
  );
}

// ── MY CHALLENGE SCORE ───────────────────────────────────────────────────────
//
// Replaces a card that was entirely fabricated — an invented username, rank, score
// and a hardcoded "you need 0 misses to qualify" line that had nothing to do with the
// round's actual requirement.
//
// The score is read from osu! rather than typed in: the player's play on a public
// beatmap is public data, so there is nothing for them to assert and nothing to
// dispute. Importing again picks up a better play.

function MyChallengeScore({
  score,
  requirement,
  modRequirement,
  onImport,
  user,
  onLogin,
}: {
  score: ApiChallengeScore | null;
  requirement: string | null;
  modRequirement: string | null;
  onImport: () => Promise<string | null>;
  user: AuthUser | null;
  onLogin?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setError(await onImport());
    setBusy(false);
  };

  const importButton = (
    <button
      type="button"
      disabled={busy}
      onClick={() => { void run(); }}
      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black bg-amber-400 hover:bg-amber-300 text-slate-950 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
      {busy ? 'Reading osu!…' : score ? 'Refresh from osu!' : 'Import my score'}
    </button>
  );

  return (
    <div className="bg-[#0d1526] border border-amber-400/20 rounded-2xl p-6">
      <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono mb-5">
        My Challenge Score
      </p>

      {error && (
        <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3 py-2 mb-4">
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-px" />
          <p className="text-[11px] text-rose-300 flex-1">{error}</p>
          <button type="button" onClick={() => setError(null)} className="opacity-60 hover:opacity-100 flex-shrink-0">
            <X className="w-3 h-3 text-rose-300" />
          </button>
        </div>
      )}

      {!user ? (
        <div className="text-center py-4">
          <p className="text-sm text-slate-400 mb-4">Log in to post your score for this challenge.</p>
          <button
            type="button"
            onClick={onLogin}
            className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs rounded-xl transition-all"
          >
            Login with osu!
          </button>
        </div>
      ) : !score && !user.canChallenge ? (
        /* The server would refuse the import with a 403, so the button is not offered.
           Reading the leaderboard is still open to everybody — that is the E2 decision,
           not a consolation. Ordered before the empty state but AFTER the score check: an
           account blocked after posting a score still sees the score it earned. */
        <div className="space-y-3 py-2">
          <div className="flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-slate-400 leading-relaxed">
              This account cannot compete in the challenge.
            </p>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            The challenge is limited to the community's countries, and an administrator can
            also restrict an individual account. The leaderboard below is open to read either
            way.
          </p>
        </div>
      ) : !score ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-400 leading-relaxed">
            Play the challenge map on osu!, then import your score — it is read straight from
            your osu! profile, so there is nothing to type in.
          </p>
          {requirement && (
            <p className="text-[11px] text-slate-500 leading-relaxed">
              This round asks for <span className="text-amber-400 font-bold">{requirement}</span>
              {modRequirement && modRequirement !== 'NM' && (
                <> with <span className="text-white font-mono font-bold">{modRequirement}</span></>
              )}
              {modRequirement === 'NM' && <> with no mods</>}.
            </p>
          )}
          {importButton}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-full bg-amber-400/10 border-2 border-amber-400/25 flex items-center justify-center flex-shrink-0">
              <span className="text-amber-400 font-black text-xl">
                {score.rank > 0 ? `#${score.rank}` : '—'}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-white font-bold truncate">{score.username}</p>
              <div className="mt-1">
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                    score.qualified
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                  }`}
                >
                  {score.qualified ? 'QUALIFIED' : 'NOT QUALIFIED'}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Score', value: score.score.toLocaleString() },
              { label: 'Accuracy', value: `${score.accuracy.toFixed(2)}%` },
              { label: 'Misses', value: String(score.misses) },
              { label: 'Mods', value: score.mods },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3">
                <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">{label}</div>
                <div className="text-sm font-black font-mono text-white">{value}</div>
              </div>
            ))}
          </div>

          {/* Why it did not qualify, when that can be said from the play alone. The
              three relative requirements cannot be judged this way — they are the
              leaderboard's order — so nothing is claimed about them here. */}
          {!score.qualified && (
            <p className="text-[11px] text-slate-600 mt-4 leading-relaxed">
              {requirement === 'Full Combo' && score.misses > 0
                ? `This round asks for a Full Combo and this play has ${score.misses} miss${score.misses === 1 ? '' : 'es'}.`
                : modRequirement
                  ? `This round asks for ${modRequirement === 'NM' ? 'no mods' : modRequirement}, and this play was set with ${score.mods}.`
                  : 'This play did not meet the round requirement.'}
            </p>
          )}

          {user.canChallenge ? (
            <div className="mt-4">{importButton}</div>
          ) : (
            /* The row stays — it was earned and it is on the leaderboard — but refreshing
               it is the permission this account no longer has. */
            <p className="text-[11px] text-slate-600 mt-4 leading-relaxed">
              This account can no longer refresh its score.
            </p>
          )}
          {score.osuScoreId === null && (
            <p className="text-[10px] text-slate-600 mt-2">
              Entered by an administrator rather than imported.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── CHALLENGE LEADERBOARD ────────────────────────────────────────────────────

/**
 * The round's real scores, in the order the server returned them.
 *
 * That order is not decorative: three of the four challenge requirements are relative
 * ('Top #1 Score', 'Best Accuracy', 'Lowest Miss Count'), so the server sorts by the
 * one this round asked for and this table must not re-sort. `qualified` carries only
 * what a single play can be judged on by itself.
 */
function ChallengeLeaderboard({
  roundNumber,
  scores,
  loaded,
  myUserId,
  requirement,
}: {
  roundNumber: number;
  scores: ApiChallengeScore[];
  loaded: boolean;
  myUserId: number | null;
  requirement: string | null;
}) {
  return (
    <div className="bg-[#0d1526] border border-slate-800/80 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-white">Challenge Leaderboard</h3>
          {requirement && (
            <p className="text-[10px] text-slate-500 mt-0.5">
              Ranked by this round's requirement: {requirement}
            </p>
          )}
        </div>
        <span className="text-[10px] text-slate-600 font-mono uppercase tracking-wider">Round {roundNumber}</span>
      </div>

      {!loaded ? (
        <p className="px-5 py-10 text-sm text-slate-500 text-center">Loading scores…</p>
      ) : scores.length === 0 ? (
        <p className="px-5 py-10 text-sm text-slate-500 text-center">
          No scores yet. Play the challenge map and import your score to be the first.
        </p>
      ) : (
      <>

      {/* Header row */}
      {/* RESPONSIVE, and the breakpoints are chosen so nothing is ever lost. Rank, player and
          DZPP are always here. The qualified badge joins at sm, and score, accuracy, misses and
          mods at lg — below which every one of them appears in the sub-line under the username
          instead, so a narrow screen shows the same facts in a taller row rather than fewer
          facts in a clipped one. */}
      <div className="flex items-center gap-2 sm:gap-4 px-3 sm:px-5 py-2 bg-slate-900/30 border-b border-slate-800/40">
        <span className="w-6 text-[10px] text-slate-600 font-mono">#</span>
        <span className="w-8 flex-shrink-0" />
        <span className="flex-1 text-[10px] text-slate-600 uppercase tracking-wider">Player</span>
        <span
          className="w-16 sm:w-20 text-[10px] text-amber-400 uppercase tracking-wider text-right"
          title="Provisional DZPP — placement and the field factor both move while the challenge is open"
        >
          DZPP
        </span>
        <span className="hidden lg:block w-24 text-[10px] text-slate-600 uppercase tracking-wider text-right">Score</span>
        <span className="hidden lg:block w-14 text-[10px] text-slate-600 uppercase tracking-wider text-right">Acc</span>
        <span className="hidden lg:block w-14 text-[10px] text-slate-600 uppercase tracking-wider text-right">Miss</span>
        <span className="hidden lg:block w-10 text-[10px] text-slate-600 uppercase tracking-wider text-center">Mod</span>
        <span className="hidden sm:block w-28 text-[10px] text-slate-600 uppercase tracking-wider text-center">Status</span>
      </div>

      <div className="divide-y divide-slate-800/40">
        {scores.map((entry) => {
          const isMe = myUserId !== null && entry.userId === myUserId;
          return (
          <div
            key={entry.userId}
            className={`flex items-center gap-2 sm:gap-4 px-3 sm:px-5 py-3 transition-colors ${
              isMe
                ? 'bg-amber-400/5 border-l-2 border-l-amber-400'
                : entry.qualified
                ? 'hover:bg-emerald-500/5'
                : 'hover:bg-slate-800/20'
            }`}
          >
            {/* Rank */}
            <span className="w-6 text-sm font-black font-mono text-slate-600 text-center flex-shrink-0">
              {entry.rank}
            </span>

            {/* Avatar — the osu! one when we have it, the initial when we do not. */}
            {entry.avatarUrl ? (
              <img
                src={entry.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full flex-shrink-0 object-cover bg-slate-800"
              />
            ) : (
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
                  entry.qualified
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                {entry.username.slice(0, 1).toUpperCase()}
              </div>
            )}

            {/* Username, and below lg the columns that are hidden at that width. Same numbers,
                one line down — not a reduced row. */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold truncate ${isMe ? 'text-amber-400' : 'text-white'}`}>
                {entry.username}
                {isMe && <span className="text-amber-400/60 font-normal ml-1 text-xs">(you)</span>}
              </p>
              <p className="lg:hidden text-[10px] font-mono text-slate-500 truncate mt-0.5">
                {entry.score.toLocaleString()} · {entry.accuracy.toFixed(1)}% ·{' '}
                <span className={entry.misses === 0 ? 'text-emerald-400' : 'text-slate-500'}>
                  {entry.misses}×
                </span>{' '}
                · {entry.mods}
                <span className={`sm:hidden ${entry.qualified ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {' · '}{entry.qualified ? 'QUALIFIED' : 'NOT QUAL.'}
                </span>
              </p>
            </div>

            {/* Provisional DZPP. Computed by the server with the approved engine — the same
                scoreRound that freezes round_dzpp when the round ends — so this is the live
                view of one formula rather than a second one. Null when the read could not
                know the qualified field size. */}
            <span className="w-16 sm:w-20 text-right flex-shrink-0 tabular-nums">
              {entry.dzpp === null ? (
                <span className="text-xs font-mono text-slate-700">—</span>
              ) : (
                <span className={`text-sm font-black font-mono ${entry.qualified ? 'text-amber-400' : 'text-amber-400/50'}`}>
                  {entry.dzpp.toLocaleString()}
                </span>
              )}
            </span>

            {/* Score */}
            <span className="hidden lg:block w-24 text-sm font-black font-mono text-white text-right flex-shrink-0">
              {entry.score.toLocaleString()}
            </span>

            {/* Accuracy */}
            <span className="hidden lg:block w-14 text-xs font-mono text-slate-400 text-right flex-shrink-0">
              {entry.accuracy.toFixed(1)}%
            </span>

            {/* Misses */}
            <span className={`hidden lg:block w-14 text-xs font-mono text-right flex-shrink-0 ${entry.misses === 0 ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
              {entry.misses}×
            </span>

            {/* Mods */}
            <div className="hidden lg:flex w-10 justify-center flex-shrink-0">
              <span className="text-[10px] font-mono font-bold bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-slate-300">
                {entry.mods}
              </span>
            </div>

            {/* Qualification. Held from sm rather than lg: whether a play counts at all is the
                most important fact after DZPP, so it survives one breakpoint longer than the
                raw numbers do. */}
            <div className="hidden sm:flex w-28 justify-center flex-shrink-0">
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                entry.qualified
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}>
                {entry.qualified
                  ? <><CheckCircle2 className="w-3 h-3" /> QUALIFIED</>
                  : <><AlertCircle className="w-3 h-3" /> NOT QUALIFIED</>
                }
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {/* Said once, plainly: these numbers are not final. Placement moves as scores arrive and
          the field factor grows with the qualified field, so the column is a running estimate
          until the round ends and repo/dzpp.ts freezes it. */}
      <p className="px-5 py-3 border-t border-slate-800/40 text-[10px] text-slate-600 font-mono">
        DZPP is provisional while the challenge is open — placement and the field factor both
        move as scores arrive. It is frozen when the round ends.
      </p>
      </>
      )}
    </div>
  );
}

// ── SUBMISSION PHASE PANELS ──────────────────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl px-4 py-2.5 text-right min-w-[7.5rem]">
      <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`text-lg font-black font-mono ${tone}`}>{value}</div>
    </div>
  );
}

/**
 * The count is of *approved* entries, not of everything received. GET
 * /api/submissions serves approved rows only, and there is no public total, so
 * showing anything else here would need a new API field.
 */
function SubmissionStatusBand({
  round,
  approvedCount,
  countdown,
}: {
  round: CurrentRound;
  approvedCount: number;
  countdown: string;
}) {
  return (
    <div className="bg-[#0d1526] border border-amber-400/20 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
            <h2 className="text-lg font-black text-white">
              Round {round.roundNumber} — Submissions Open
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Closes {formatDeadline(round.schedule.submission)}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Stat label="Closes in" value={countdown} tone="text-amber-400" />
          <Stat label="Approved for voting" value={String(approvedCount)} tone="text-white" />
        </div>
      </div>
      <p className="text-[11px] text-slate-600 mt-4 leading-relaxed">
        Entries stay private while submissions are open — only the number already approved is shown,
        so nobody's pick is swayed by what is in already.
      </p>
    </div>
  );
}

function YourSubmission({
  submission,
  onWithdraw,
  onNavigate,
}: {
  submission: ApiSubmission | null;
  onWithdraw: () => Promise<string | null>;
  onNavigate: (page: PlatformPage) => void;
}) {
  const copy = submission ? REVIEW_PRESENTATION[submission.reviewStatus] : null;

  return (
    <section>
      <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono mb-1">This round</p>
      <h2 className="text-xl font-black text-white mb-5">Your Submission</h2>

      {submission && copy ? (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,22rem)_1fr] gap-5 items-start">
          <BeatmapCardPlatform beatmap={toBeatmap(submission)} />
          <div className="bg-[#0d1526] border border-slate-800 rounded-2xl p-5 space-y-4">
            <div>
              <span className={`inline-block text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-full border ${copy.tone}`}>
                {copy.label}
              </span>
              <p className="text-xs text-slate-500 mt-3 leading-relaxed">{copy.blurb}</p>
            </div>
            <div className="h-px bg-slate-800" />
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono mb-2">
                Challenge requirements
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-black font-mono bg-slate-800 border border-slate-700 px-3 py-1 rounded-lg text-white">
                  {submission.modRequirement}
                </span>
                <span className="text-sm font-bold bg-amber-400/10 border border-amber-400/25 px-3 py-1 rounded-lg text-amber-400">
                  {submission.challengeRequirement}
                </span>
              </div>
            </div>
            <a
              href={beatmapUrl(submission)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-400 transition-colors"
            >
              <LinkIcon className="w-3.5 h-3.5" />
              Open on osu!
            </a>
            <WithdrawButton onWithdraw={onWithdraw} />
          </div>
        </div>
      ) : (
        <div className="bg-[#0d1526] border border-slate-800 rounded-2xl px-6 py-10 text-center">
          <div className="w-14 h-14 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-4">
            <Upload className="w-6 h-6 text-slate-700" />
          </div>
          <p className="text-white font-bold mb-1">You haven't submitted a beatmap yet</p>
          <p className="text-sm text-slate-500 mb-5 max-w-md mx-auto">
            One submission per player per round. Pick a Ranked, Loved or Approved difficulty and set
            the mod and challenge it should be played under.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('submit')}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-sm rounded-xl transition-all"
          >
            <Upload className="w-4 h-4" />
            Submit a Beatmap
          </button>
        </div>
      )}
    </section>
  );
}

/** The four rules the server actually enforces today. The submit page carries the full set. */
function SubmissionRequirements({ onNavigate }: { onNavigate: (page: PlatformPage) => void }) {
  const rules = [
    'Ranked, Loved or Approved beatmap',
    'A specific difficulty, not just the beatmapset',
    'One submission per player per round',
    'An osu! account eligible to submit',
  ];

  return (
    <div className="bg-[#0d1526] border border-slate-800 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-black text-white">Submission Requirements</h3>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('submit')}
          className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-amber-400 transition-colors"
        >
          Full requirements
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {rules.map((rule) => (
          <div key={rule} className="flex items-start gap-2.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-slate-400 leading-relaxed">{rule}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── DASHBOARD PAGE ───────────────────────────────────────────────────────────

/**
 * "Load my osu! favorites" (A5).
 *
 * The button used to be decoration — no handler at all. It now reports what happened,
 * because an import that finds nothing and an import that failed look identical if the
 * button just goes quiet, and "nothing happened" was the old behaviour.
 */
function ImportFavoritesButton({
  onImport,
  disabled,
}: {
  onImport: () => Promise<string | null>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    const error = await onImport();
    setBusy(false);
    setFailed(error !== null);
    setMessage(error ?? 'Imported your osu! favourites.');
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || disabled}
        title={disabled ? 'Log in to import your osu! favourites' : undefined}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-400 hover:text-white text-xs font-bold transition-all"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
        {busy ? 'Importing…' : 'Load my osu! favorites'}
      </button>
      {message && (
        <p className={`text-[10px] ${failed ? 'text-rose-400/90' : 'text-slate-500'}`}>{message}</p>
      )}
    </div>
  );
}

interface DashboardPageProps {
  round: CurrentRound | null;
  /** Approved submissions in the open round. Empty until an admin approves one. */
  maps: Beatmap[];
  /** The caller's favorites, both sources, server-held (A4). Empty when signed out. */
  favorites: Beatmap[];
  /** Takes the map, not its id: favoriting addresses the osu! beatmap (A4). */
  onFavorite: (map: Beatmap) => void;
  /** Imports the osu! profile favourites (A5). Resolves to an error message, or null. */
  onImportFavorites: () => Promise<string | null>;
  /**
   * "Submit" on a favorite card. Carries the beatmap, where this used to be onNavigate('submit')
   * and carried nothing — so the player landed on an empty URL box and had to find it again.
   */
  onSubmitBeatmap: (map: Beatmap) => void;
  /** The signed-in user's own entry, whatever its review status. */
  mySubmission: ApiSubmission | null;
  /** Resolves to an error message, or null once the entry is withdrawn. */
  onWithdraw: () => Promise<string | null>;
  /** Submission id the caller voted for in the open round, or null. Server-held. */
  myVote: number | null;
  /** Beatmap id whose cast or retract is in flight. */
  voteBusy: string | null;
  voteError: string | null;
  onVote: (id: string) => void;
  onDismissVoteError: () => void;
  /** The round's challenge scores, already ordered by the server. Never re-sort them. */
  challengeScores: ApiChallengeScore[];
  /** False until the first leaderboard read resolves, so "empty" is not shown early. */
  challengeLoaded: boolean;
  /** The caller's own recorded score for this round, or null. */
  myScore: ApiChallengeScore | null;
  /** Imports the caller's osu! score. Resolves to an error message, or null on success. */
  onImportScore: () => Promise<string | null>;
  onNavigate: (page: PlatformPage) => void;
  user: AuthUser | null;
  onLogin?: () => void;
}

function NoActiveRound() {
  return (
    <div className="bg-[#0d1526] border border-slate-800 rounded-2xl px-8 py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-5">
        <Clock className="w-7 h-7 text-slate-700" />
      </div>
      <p className="text-white font-bold mb-1">No round is running</p>
      <p className="text-sm text-slate-500 max-w-md mx-auto">
        The next monthly round has not been opened yet. Submissions, voting, and the challenge
        leaderboard all appear here once it starts.
      </p>
    </div>
  );
}

export function DashboardPage({
  round,
  maps,
  favorites,
  onFavorite,
  onImportFavorites,
  onSubmitBeatmap,
  mySubmission,
  onWithdraw,
  myVote,
  voteBusy,
  voteError,
  onVote,
  onDismissVoteError,
  challengeScores,
  challengeLoaded,
  myScore,
  onImportScore,
  onNavigate,
  user,
  onLogin,
}: DashboardPageProps) {
  // One ticking countdown for the page, called before the early return below so
  // the hook order never changes. Both the header and the challenge hero use it.
  const countdown = useCountdown(round?.endsAt);

  // The vote lives on the server. This page used to keep its own useState for it,
  // which reset on every mount and never agreed with the vote page.
  const canVote = user?.canVote ?? false;
  // The ballot closes on winnerStatus while the phase is still 'voting', so every
  // vote surface below asks this rather than reading the phase.
  const ballotOpen = isBallotOpen(round);
  const myMapId = myVote === null ? null : String(myVote);
  const votedMap = myMapId === null ? null : maps.find((b) => b.id === myMapId) ?? null;
  const ownMapId = mySubmission === null ? null : String(mySubmission.id);

  /**
   * Why this entry cannot be voted for, or undefined when it can. The closed ballot
   * comes first: it is the one refusal that applies to everybody, including the
   * retraction of a vote already cast.
   */
  const refusal = (id: string): string | undefined => {
    if (!ballotOpen) return 'Voting has closed for this round';
    if (!canVote) return 'Your account is not eligible to vote in this round';
    if (id === ownMapId) return 'You cannot vote for your own submission';
    return undefined;
  };

  // Null whenever nothing is approved yet, so every use below is guarded.
  const leadingMap: Beatmap | null = maps.length
    ? maps.reduce((best, m) => ((m.voteCount ?? 0) > (best.voteCount ?? 0) ? m : best))
    : null;

  /**
   * The entry the server recorded, not the one leading a live count. Once the ballot
   * closes the two can differ — a vote retracted before the freeze, an entry rejected
   * after winning — and the recorded one is the fact. Null while a tie is unresolved,
   * or when the winner is no longer among the approved entries this page was given.
   */
  const recordedWinner: Beatmap | null =
    round?.winningSubmissionId == null
      ? null
      : maps.find((m) => m.id === String(round.winningSubmissionId)) ?? null;

  /**
   * The panel beside "Your Vote": the live leader while the ballot is open, the
   * recorded winner and its frozen count once it is closed, and an honest line while
   * a tie is unresolved. One derivation so the heading, the count and the card cannot
   * disagree about which of those three the round is in.
   */
  const standing: { label: string; map: Beatmap | null; votes: number | null; empty: string } =
    ballotOpen
      ? {
          label: 'Currently Leading',
          map: leadingMap,
          votes: leadingMap?.voteCount ?? null,
          empty: 'Nothing has been approved for voting yet.',
        }
      : round?.winnerStatus === 'tiebreak'
        ? {
            label: 'Tied at the top',
            map: null,
            votes: round.winnerVoteCount,
            empty: 'Voting ended level. An administrator picks the winner.',
          }
        : {
            label: 'Winner pending approval',
            map: recordedWinner,
            votes: round?.winnerVoteCount ?? null,
            empty: 'Voting is closed. No winning entry is on record for this round.',
          };
  // Aliased so the vote callback below closes over a narrowed const rather than
  // re-reading standing.map, which narrowing does not follow into a closure.
  const topEntry = standing.map;

  /**
   * The caller's own score. Preferred from the leaderboard, because that copy carries
   * the rank the server computed; GET /challenge/my has no rank to give, since a rank
   * only exists relative to the other plays.
   */
  const myRow =
    (user === null ? null : challengeScores.find((s) => s.userId === user.id) ?? null) ?? myScore;

  if (!round) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8 pb-16">
        <NoActiveRound />
      </div>
    );
  }

  const phase = round.phase;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 pb-16">
      <RoundHeader round={round} countdown={countdown} />

      {/* ── SUBMISSION PHASE ──────────────────────────────────────────── */}
      {phase === 'submission' && (
        <div className="space-y-10">
          {!user && (
            <LoginNudge
              message="Login with your osu! account to submit a beatmap for this round."
              onLogin={onLogin}
            />
          )}

          <SubmissionStatusBand round={round} approvedCount={maps.length} countdown={countdown} />

          {user && (
            <YourSubmission
              submission={mySubmission}
              onWithdraw={onWithdraw}
              onNavigate={onNavigate}
            />
          )}

          {/* Submit CTA — dropped once there is an entry to show above. */}
          {!mySubmission && (
          <div className="relative overflow-hidden bg-gradient-to-r from-amber-400/10 via-amber-400/5 to-transparent border border-amber-400/20 rounded-2xl p-6 flex items-center justify-between gap-6">
            <div className="absolute right-0 top-0 bottom-0 w-64 opacity-5">
              <Trophy className="w-full h-full text-amber-400" />
            </div>
            <div className="relative">
              <p className="text-[10px] uppercase tracking-widest font-mono text-amber-400/70 mb-1">This month's challenge</p>
              <h2 className="text-lg font-black text-white mb-1">Have a beatmap to propose?</h2>
              <p className="text-sm text-slate-400 max-w-lg">
                Submit a Ranked, Loved, or Approved beatmap. Players vote for their favourite — the winner becomes the monthly challenge.
              </p>
            </div>
            {user ? (
              <button
                type="button"
                onClick={() => onNavigate('submit')}
                className="flex items-center gap-2 px-6 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-sm rounded-xl transition-all flex-shrink-0 active:scale-[0.98]"
              >
                <Upload className="w-4 h-4" />
                Submit a Beatmap
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onLogin}
                className="flex items-center gap-2 px-6 py-3 bg-slate-800 border border-slate-700 hover:border-amber-400/40 text-slate-300 hover:text-white font-black text-sm rounded-xl transition-all flex-shrink-0"
              >
                <LogIn className="w-4 h-4" />
                Login to Submit
              </button>
            )}
          </div>
          )}

          <SubmissionRequirements onNavigate={onNavigate} />

          {/* Favorites */}
          <section>
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono mb-1">My Collection</p>
                <h2 className="text-xl font-black text-white">Favorite Beatmaps</h2>
              </div>
              <ImportFavoritesButton onImport={onImportFavorites} disabled={!user} />
            </div>
            {favorites.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 border border-dashed border-slate-800 rounded-2xl">
                <Heart className="w-9 h-9 text-slate-700" />
                <p className="text-slate-500 text-sm font-medium">No favorites yet.</p>
                <p className="text-xs text-slate-600">
                  {user
                    ? 'Favorite a beatmap from Search, or import the ones on your osu! profile.'
                    : 'Log in to keep a list of beatmaps you like.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {favorites.map((b) => (
                  <BeatmapCardPlatform
                    key={b.id}
                    beatmap={b}
                    showSubmitButton
                    onFavorite={() => onFavorite(b)}
                    onSubmit={() => onSubmitBeatmap(b)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── VOTING PHASE ──────────────────────────────────────────────── */}
      {phase === 'voting' && (
        <div className="space-y-10">
          {!user && (
            <LoginNudge
              message="Login with your osu! account to cast your vote for this round."
              onLogin={onLogin}
            />
          )}

          {voteError && (
            <div className="flex items-start gap-2.5 bg-rose-500/10 border border-rose-500/25 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-px" />
              <p className="text-xs text-rose-300 flex-1">{voteError}</p>
              <button
                type="button"
                onClick={onDismissVoteError}
                className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
              >
                <X className="w-3.5 h-3.5 text-rose-300" />
              </button>
            </div>
          )}

          {/* My vote + leading */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* My vote */}
            <div className="bg-[#0d1526] border border-slate-800/80 rounded-2xl p-5">
              <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono mb-4">My Vote</p>
              {!user ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-4">
                    <LogIn className="w-7 h-7 text-slate-700" />
                  </div>
                  <p className="text-white font-bold mb-1">Login to vote</p>
                  <p className="text-sm text-slate-500 mb-5">
                    Eligible players get one vote per round.
                  </p>
                  <button
                    type="button"
                    onClick={onLogin}
                    className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-sm rounded-xl transition-all"
                  >
                    Login with osu!
                  </button>
                </div>
              ) : !canVote ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-4">
                    <Ban className="w-7 h-7 text-slate-700" />
                  </div>
                  <p className="text-white font-bold mb-1">Your account cannot vote in this round.</p>
                  <p className="text-sm text-slate-500">
                    Eligibility comes from your osu! profile country, read when you log in, and can
                    be granted or withdrawn per player by an administrator.
                  </p>
                </div>
              ) : votedMap ? (
                <>
                  <p className="text-xs text-emerald-400 font-bold mb-4 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {ballotOpen ? 'You have voted' : 'Your vote is locked in'}
                  </p>
                  {/* Retracting is a write too, so it goes through the same refusal —
                      the server stops honouring it the moment the ballot closes. */}
                  <BeatmapCardPlatform
                    beatmap={votedMap}
                    voted
                    showVoteButton
                    onVote={() => onVote(votedMap.id)}
                    voteBusy={voteBusy === votedMap.id}
                    voteDisabled={refusal(votedMap.id) !== undefined}
                    voteDisabledReason={refusal(votedMap.id)}
                  />
                </>
              ) : !ballotOpen ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-4">
                    <Trophy className="w-7 h-7 text-slate-700" />
                  </div>
                  <p className="text-white font-bold mb-1">Voting has closed</p>
                  <p className="text-sm text-slate-500">
                    You did not vote in this round. The result is with the administrators now.
                  </p>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-4">
                    <Trophy className="w-7 h-7 text-slate-700" />
                  </div>
                  <p className="text-white font-bold mb-1">Your vote is waiting</p>
                  <p className="text-sm text-slate-500 mb-5">
                    Pick the beatmap you want as this month's challenge.
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('vote')}
                    className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-sm rounded-xl transition-all"
                  >
                    Vote Now
                  </button>
                </div>
              )}
            </div>

            {/* Currently leading */}
            <div className="bg-[#0d1526] border border-amber-400/25 rounded-2xl p-5 relative overflow-hidden">
              <div className="absolute top-3 right-3 opacity-5">
                <Crown className="w-20 h-20 text-amber-400" />
              </div>
              <div className="flex items-center gap-2 mb-4">
                <Crown className="w-4 h-4 text-amber-400" />
                <p className="text-[10px] uppercase tracking-widest text-amber-400/80 font-mono font-bold">{standing.label}</p>
                {standing.votes !== null && (
                  <span className="ml-auto text-[10px] font-mono text-slate-600">{standing.votes} votes</span>
                )}
              </div>
              {topEntry ? (
                <BeatmapCardPlatform
                  beatmap={topEntry}
                  showVoteButton={Boolean(user)}
                  voted={myMapId === topEntry.id}
                  onVote={() => onVote(topEntry.id)}
                  voteBusy={voteBusy === topEntry.id}
                  voteDisabled={refusal(topEntry.id) !== undefined}
                  voteDisabledReason={refusal(topEntry.id)}
                />
              ) : (
                <p className="text-sm text-slate-500 py-8 text-center">{standing.empty}</p>
              )}
            </div>
          </div>

          {/* All submissions */}
          <section>
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono mb-1">{roundLabel(round)}</p>
                <h2 className="text-xl font-black text-white">All Submitted Beatmaps</h2>
              </div>
              <span className="text-xs text-slate-600 font-mono">{maps.length} beatmaps</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {maps.map((b) => (
                <BeatmapCardPlatform
                  key={b.id}
                  beatmap={b}
                  showVoteButton={Boolean(user)}
                  voted={myMapId === b.id}
                  onVote={() => onVote(b.id)}
                  voteBusy={voteBusy === b.id}
                  voteDisabled={refusal(b.id) !== undefined}
                  voteDisabledReason={refusal(b.id)}
                />
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ── CHALLENGE PHASE ───────────────────────────────────────────── */}
      {phase === 'challenge' && (
        <div className="space-y-8">
          {/* The winning beatmap, as recorded when the winner was approved — not the
              entry leading a live count, which a later retraction could move. The
              map-dependent half stays guarded: a round archived before winners were
              recorded, or one whose winning entry was rejected afterwards, has
              nothing to show here. */}
          {recordedWinner ? (
          <div className="relative rounded-2xl overflow-hidden border border-purple-500/20 min-h-[220px]">
            <div className="absolute inset-0">
              <img
                src={recordedWinner.coverUrl}
                alt={recordedWinner.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-25"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#060c18] via-[#060c18]/85 to-[#060c18]/40" />
            </div>
            <div className="relative px-8 py-10 flex items-center justify-between gap-6 flex-wrap">
              <div>
                <div className="flex items-center gap-2.5 mb-4">
                  <Crown className="w-5 h-5 text-amber-400" />
                  <span className="text-[10px] font-black tracking-widest text-amber-400 uppercase font-mono">
                    Monthly Challenge · {roundLabel(round)}
                  </span>
                </div>
                <h2 className="text-3xl font-black text-white mb-1 tracking-tight">{recordedWinner.title}</h2>
                <p className="text-slate-300 mb-1">{recordedWinner.artist}</p>
                <p className="text-slate-500 text-sm mb-5">
                  mapped by <span className="text-slate-300 font-medium">{recordedWinner.mapper}</span>
                  <span className="mx-2 text-slate-700">·</span>
                  <span className="font-mono text-amber-400">★ {recordedWinner.stars.toFixed(2)}</span>
                  <span className="mx-2 text-slate-700">·</span>
                  <span className="font-mono text-slate-400">{recordedWinner.bpm} BPM</span>
                  <span className="mx-2 text-slate-700">·</span>
                  <span className="font-mono text-slate-400">{recordedWinner.length}</span>
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/70 border border-slate-700 rounded-full">
                    <span className="text-[10px] text-slate-500">Required mod</span>
                    <span className="text-sm font-black font-mono text-white">{recordedWinner.modRequirement}</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-400/10 border border-amber-400/25 rounded-full">
                    <span className="text-[10px] text-slate-500">Challenge</span>
                    <span className="text-sm font-bold text-amber-400">{recordedWinner.challengeType}</span>
                  </div>
                </div>
              </div>

              {/* Countdown + Bounty */}
              <div className="flex flex-col gap-3 flex-shrink-0">
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl px-6 py-4 text-right">
                  <div className="flex items-center gap-2 justify-end mb-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Challenge ends in</span>
                  </div>
                  <div className="text-3xl font-black font-mono text-purple-400">{countdown}</div>
                </div>
                <div className="bg-amber-400/10 border border-amber-400/25 rounded-2xl px-6 py-4 text-right">
                  <p className="text-[10px] text-amber-400/60 uppercase tracking-wider font-bold mb-1">Monthly Bounty</p>
                  <p className="text-sm font-black text-amber-400">{round.reward || 'To be announced'}</p>
                </div>
              </div>
            </div>
          </div>
          ) : (
            <div className="bg-[#0d1526] border border-slate-800 rounded-2xl px-8 py-10 flex items-center justify-between gap-6 flex-wrap">
              <div>
                <span className="text-[10px] font-black tracking-widest text-amber-400 uppercase font-mono">
                  Monthly Challenge · {roundLabel(round)}
                </span>
                <p className="text-sm text-slate-400 mt-2 max-w-md">
                  No winner is on record for this round, so there is no challenge map to show.
                </p>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl px-6 py-4 text-right flex-shrink-0">
                <div className="flex items-center gap-2 justify-end mb-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Challenge ends in</span>
                </div>
                <div className="text-3xl font-black font-mono text-purple-400">{countdown}</div>
              </div>
            </div>
          )}

          {/* My rank + leaderboard */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <MyChallengeScore
              score={myRow}
              requirement={recordedWinner?.challengeType ?? null}
              modRequirement={recordedWinner?.modRequirement ?? null}
              onImport={onImportScore}
              user={user}
              onLogin={onLogin}
            />

            {/* Leaderboard */}
            <div className="lg:col-span-2">
              <ChallengeLeaderboard
                roundNumber={round.roundNumber}
                scores={challengeScores}
                loaded={challengeLoaded}
                myUserId={user?.id ?? null}
                requirement={recordedWinner?.challengeType ?? null}
              />
            </div>
          </div>

          {/* Live chat — challenge phase only, never archived */}
          <section>
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono mb-1">Live</p>
              <h2 className="text-xl font-black text-white">Challenge Chat</h2>
              <p className="text-xs text-slate-500 mt-1">
                Chat with the community during this challenge. Messages are not archived.
              </p>
            </div>
            <ChallengeChat user={user} onLogin={onLogin} />
          </section>
        </div>
      )}
    </div>
  );
}
