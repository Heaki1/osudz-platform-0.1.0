import React, { useEffect, useState } from 'react';
import { Beatmap, PlatformPage } from '../../types';
import { ApiSiteSettings, api, ApiBeatmapPreview, ApiSubmission } from '../../api/client';
import { CurrentRound, pageAccess, roundLabel } from '../../lib/round';
import { beatmapUrl, previewToBeatmap, REVIEW_PRESENTATION, toBeatmap } from '../../lib/submission';
import { BeatmapCardPlatform } from './BeatmapCardPlatform';
import { AuthUser } from './NavHeader';
import { PhaseGate } from './PhaseGate';
import { WithdrawButton } from './WithdrawButton';
import {
  Upload, Star, Clock, CheckCircle2,
  Link, Heart, ChevronRight, X, AlertCircle, LogIn,
} from 'lucide-react';

// ── ELIGIBILITY RULES PANEL ───────────────────────────────────────────────────

/** "0:30" from raw seconds, matching how the server phrases a length refusal. */
const formatSeconds = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A bound pair as one line, or "Any" when the administrator has set neither (C8). */
function boundLabel(
  min: number | null,
  max: number | null,
  format: (n: number) => string
): string {
  if (min === null && max === null) return 'Any';
  if (min !== null && max === null) return `${format(min)} or more`;
  if (min === null && max !== null) return `up to ${format(max)}`;
  return `${format(min!)} — ${format(max!)}`;
}

function EligibilityPanel({ settings }: { settings: ApiSiteSettings | null }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-[#0d1526] border border-slate-800 rounded-2xl mb-6 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-bold text-white">Submission Eligibility Rules</span>
        </div>
        <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-slate-800/60">
          <p className="text-xs text-slate-500 mt-3 mb-4">
            Your beatmap must satisfy all of the following before it can be submitted.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
                label: 'Beatmap status',
                // The real list, not a hardcoded "Ranked, Loved, or Approved": an
                // administrator can narrow it, and this used to say otherwise (C8).
                value: settings ? settings.allowedStatuses.map(titleCase).join(', ') || 'None' : '…',
              },
              {
                icon: <Star className="w-4 h-4 text-amber-400" />,
                label: 'Star rating',
                value: settings ? boundLabel(settings.minStars, settings.maxStars, (n) => `${n.toFixed(2)}★`) : '…',
              },
              {
                icon: <Clock className="w-4 h-4 text-blue-400" />,
                label: 'Length',
                value: settings ? boundLabel(settings.minLengthSeconds, settings.maxLengthSeconds, formatSeconds) : '…',
              },
              { icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />, label: 'Per player', value: '1 submission per round' },
            ].map(({ icon, label, value }) => (
              <div key={label} className="flex items-center gap-3 bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2.5">
                {icon}
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
                  <p className="text-sm font-bold text-white">{value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── MOD + CHALLENGE REQUIREMENT SELECTORS ────────────────────────────────────

// The two lists come from GET /api/settings now (C9), which is the same row the server
// validates a submission against. They used to be hardcoded here and in
// server/src/repo/submissions.ts — two copies of the same list, and the admin `challenge` tab
// rendered a third that saved nothing.

interface RequirementsProps {
  mod: string | null;
  challengeType: string | null;
  onModChange: (m: string | null) => void;
  onTypeChange: (t: string | null) => void;
  settings: ApiSiteSettings | null;
}

function RequirementsSelector({ mod, challengeType, onModChange, onTypeChange, settings }: RequirementsProps) {
  const MODS = settings?.allowedMods ?? [];
  const CHALLENGE_TYPES = settings?.allowedChallengeTypes ?? [];
  return (
    <div className="space-y-5">
      {/* Mod */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-mono text-slate-600 mb-2">Required Mod</p>
        <div className="flex flex-wrap gap-2">
          {MODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModChange(mod === m ? null : m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition-all ${
                mod === m
                  ? 'bg-indigo-500/25 border-indigo-500/50 text-indigo-200'
                  : 'bg-slate-900/50 border-slate-700/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Challenge type */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-mono text-slate-600 mb-2">Challenge Type</p>
        <div className="grid grid-cols-2 gap-2">
          {CHALLENGE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTypeChange(challengeType === t ? null : t)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all text-left ${
                challengeType === t
                  ? 'bg-amber-400/15 border-amber-400/40 text-amber-400'
                  : 'bg-slate-900/50 border-slate-700/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              {challengeType === t && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />}
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── URL TAB ───────────────────────────────────────────────────────────────────

function UrlTab({
  onSubmitted,
  settings,
}: {
  onSubmitted: (submission: ApiSubmission) => void;
  settings: ApiSiteSettings | null;
}) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ApiBeatmapPreview | null>(null);
  const [mod, setMod] = useState<string | null>(null);
  const [challengeType, setChallengeType] = useState<string | null>(null);

  const handleLoad = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    const result = await api.submissions.lookup(url);
    if (result.ok) setPreview(result.data);
    else setError(result.error);
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!preview || !mod || !challengeType) return;
    setSubmitting(true);
    setError(null);
    const result = await api.submissions.submit({
      difficultyId: preview.difficultyId,
      modRequirement: mod,
      challengeRequirement: challengeType,
    });
    setSubmitting(false);
    if (result.ok) onSubmitted(result.data);
    else setError(result.error);
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2.5 bg-rose-500/10 border border-rose-500/25 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-px" />
          <p className="text-xs text-rose-300 flex-1">{error}</p>
          <button type="button" onClick={() => setError(null)} className="text-rose-400/60 hover:text-rose-300 flex-shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* URL input */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-mono text-slate-600 mb-2">Beatmap URL</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setPreview(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleLoad(); }}
              placeholder="https://osu.ppy.sh/beatmapsets/41823#osu/131891"
              className="w-full bg-[#0d1526] border border-slate-800 focus:border-amber-400/50 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none transition-colors"
            />
          </div>
          <button
            type="button"
            onClick={() => { void handleLoad(); }}
            disabled={!url.trim() || loading}
            className="flex items-center gap-2 px-5 py-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-sm rounded-xl transition-all flex-shrink-0"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
        <p className="text-[11px] text-slate-600 mt-2">
          Link a specific difficulty — the URL osu! shows once you have picked one.
        </p>
      </div>

      {/* Preview */}
      {preview && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-emerald-400">Beatmap found — verify the details below</span>
          </div>
          <div className="max-w-sm">
            <BeatmapCardPlatform beatmap={previewToBeatmap(preview)} />
          </div>

          <div className="h-px bg-slate-800" />

          <RequirementsSelector
            mod={mod}
            challengeType={challengeType}
            onModChange={setMod}
            onTypeChange={setChallengeType}
            settings={settings}
          />

          <button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={!mod || !challengeType || submitting}
            className="flex items-center gap-2 px-6 py-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black text-sm rounded-xl transition-all"
          >
            <Upload className="w-4 h-4" />
            {submitting ? 'Submitting…' : 'Submit to Community Vote'}
          </button>
          {(!mod || !challengeType) && (
            <p className="text-[11px] text-slate-600">Select a mod and challenge type to continue.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── FAVORITES TAB ─────────────────────────────────────────────────────────────

interface FavoritesTabProps {
  /** The caller's favorites, server-held (A4). */
  favorites: Beatmap[];
  onFavorite: (map: Beatmap) => void;
  onSubmitted: (submission: ApiSubmission) => void;
  /** The administrator-defined rules, for the mod and challenge-type lists (C9). */
  settings: ApiSiteSettings | null;
  /**
   * A difficulty the player already chose elsewhere — the dashboard's favorite cards.
   *
   * AN ID, NOT A BEATMAP, and resolved against `favorites` below. Preselecting an object handed in
   * from another page would let a card that is no longer a favorite reach the requirement pickers;
   * looking it up here means the selection is always one of this tab's own rows, so every
   * eligibility and validation rule applies exactly as if it had been clicked.
   */
  preselectedDifficultyId?: number | null;
}

/**
 * Submitting from a favorite.
 *
 * This tab used to be fabricated end to end: six fixture maps, and a Submit button that set
 * a local `submitted` flag and told the player their beatmap "has been submitted for
 * community voting" without any request leaving the browser. It now goes through the same
 * api.submissions.submit the URL tab uses, so the two paths cannot disagree about what a
 * submission is.
 */
function FavoritesTab({
  favorites,
  onFavorite,
  onSubmitted,
  settings,
  preselectedDifficultyId,
}: FavoritesTabProps) {
  const [selected, setSelected] = useState<Beatmap | null>(null);
  const [mod, setMod] = useState<string | null>(null);
  const [challengeType, setChallengeType] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSelected(null);
    setMod(null);
    setChallengeType(null);
    setError(null);
  };

  /**
   * Adopts a handoff from the dashboard, once, as soon as the favorite it names is loaded.
   *
   * Keyed on the id and the list, so it also fires when the favorites arrive AFTER the navigation —
   * which is the normal case, since App reads them asynchronously. A id that matches nothing leaves
   * the tab on its list rather than selecting something arbitrary; that happens when the beatmap
   * was unfavorited in between, and showing the list is the honest answer.
   */
  useEffect(() => {
    if (preselectedDifficultyId === null || preselectedDifficultyId === undefined) return;
    const match = favorites.find((b) => b.difficultyId === preselectedDifficultyId);
    if (match) setSelected(match);
  }, [preselectedDifficultyId, favorites]);

  const handleSubmit = async () => {
    // A favorite without a difficulty id cannot be submitted, and there is no such row:
    // every favorite is stored by difficulty id. The guard is for the type, not the case.
    if (!selected?.difficultyId || !mod || !challengeType) return;
    setSubmitting(true);
    setError(null);
    const result = await api.submissions.submit({
      difficultyId: selected.difficultyId,
      modRequirement: mod,
      challengeRequirement: challengeType,
    });
    setSubmitting(false);
    if (result.ok) {
      // The page swaps to MySubmission on this, so there is no local success screen to
      // keep in step with the server's answer.
      onSubmitted(result.data);
      return;
    }
    setError(result.error);
  };

  if (selected) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Back to favorites
          </button>
        </div>
        <div className="max-w-sm">
          <BeatmapCardPlatform beatmap={selected} />
        </div>
        <div className="h-px bg-slate-800" />
        <RequirementsSelector
          mod={mod}
          challengeType={challengeType}
          onModChange={setMod}
          onTypeChange={setChallengeType}
          settings={settings}
        />
        {error && (
          <div className="flex items-start gap-2.5 bg-rose-500/8 border border-rose-500/25 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-px" />
            <p className="text-xs text-rose-300/90">{error}</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!mod || !challengeType || submitting}
          className="flex items-center gap-2 px-6 py-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black text-sm rounded-xl transition-all"
        >
          <Upload className="w-4 h-4" />
          {submitting ? 'Submitting…' : 'Submit to Community Vote'}
        </button>
        {(!mod || !challengeType) && (
          <p className="text-[11px] text-slate-600">Select a mod and challenge type to continue.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">
        Select a favorited beatmap to submit it for the community vote. Only Ranked, Loved and
        Approved beatmaps can be entered — the server checks that when you submit, so a
        graveyard favorite is refused there rather than hidden here.
      </p>

      {favorites.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 border border-dashed border-slate-800 rounded-2xl">
          <Heart className="w-10 h-10 text-slate-700" />
          <p className="text-slate-500">No favorited beatmaps yet.</p>
          <p className="text-xs text-slate-600">
            Favorite one from Search, import your osu! favorites from the dashboard, or use the
            URL tab.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {favorites.map((b) => (
            <BeatmapCardPlatform
              key={b.id}
              beatmap={b}
              showSubmitButton
              onSubmit={() => setSelected(b)}
              onFavorite={() => onFavorite(b)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── LOGIN GATE ────────────────────────────────────────────────────────────────

function LoginGate({ onLogin }: { onLogin?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-20 text-center">
      <div className="w-20 h-20 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
        <LogIn className="w-9 h-9 text-slate-500" />
      </div>
      <div>
        <h2 className="text-2xl font-black text-white mb-2">Login required</h2>
        <p className="text-slate-400 max-w-sm text-sm leading-relaxed">
          You need to be logged in with your osu! account to submit a beatmap for the community vote.
        </p>
      </div>
      <button
        type="button"
        onClick={onLogin}
        className="flex items-center gap-2 px-8 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 text-sm font-black rounded-xl transition-all"
      >
        <LogIn className="w-4 h-4" />
        Login with osu!
      </button>
      <p className="text-xs text-slate-600">
        Submitting is limited to players from the participating countries.
      </p>
    </div>
  );
}

// ── PLATFORM SUBMIT PAGE ──────────────────────────────────────────────────────

type SubmitTab = 'url' | 'favorites';

/**
 * Signed in, but not allowed to submit — either the profile country is not on the
 * allowlist or an administrator set an override (C5). The page does not restate which,
 * because it does not know: canSubmit is the resolved verdict, and guessing at the reason
 * is how the old "Only Algerian osu! players" copy became wrong.
 */
function IneligibleGate() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 border border-dashed border-slate-800 rounded-2xl">
      <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center">
        <AlertCircle className="w-7 h-7 text-slate-700" />
      </div>
      <p className="text-white font-bold">Your account cannot submit a beatmap.</p>
      <p className="text-xs text-slate-500 max-w-md text-center">
        Eligibility comes from your osu! profile country, read when you log in, and can be
        granted or withdrawn per player by an administrator. You can still browse, search and
        favorite beatmaps.
      </p>
    </div>
  );
}

/** One submission per user per round, so once there is one there is nothing to add. */
function MySubmission({
  submission,
  onWithdraw,
}: {
  submission: ApiSubmission;
  onWithdraw: () => Promise<string | null>;
}) {
  const copy = REVIEW_PRESENTATION[submission.reviewStatus];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-full border ${copy.tone}`}>
          {copy.label}
        </span>
        <p className="text-xs text-slate-500">{copy.blurb}</p>
      </div>

      <div className="max-w-sm">
        <BeatmapCardPlatform beatmap={toBeatmap(submission)} />
      </div>

      <div className="bg-[#0d1526] border border-slate-800 rounded-2xl p-5 space-y-3">
        <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono">Your challenge requirements</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black font-mono bg-slate-800 border border-slate-700 px-3 py-1 rounded-lg text-white">
            {submission.modRequirement}
          </span>
          <span className="text-sm font-bold bg-amber-400/10 border border-amber-400/25 px-3 py-1 rounded-lg text-amber-400">
            {submission.challengeRequirement}
          </span>
        </div>
        <a
          href={beatmapUrl(submission)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-400 transition-colors"
        >
          <Link className="w-3.5 h-3.5" />
          Open on osu!
        </a>
      </div>

      <WithdrawButton onWithdraw={onWithdraw} />
    </div>
  );
}

interface PlatformSubmitPageProps {
  round: CurrentRound | null;
  /** The caller's entry in the open round, fetched once in App. */
  mySubmission: ApiSubmission | null;
  /** The caller's favorites, both sources, server-held (A4). */
  favorites: Beatmap[];
  /** Takes the map, not its id: favoriting addresses the osu! beatmap (A4). */
  onFavorite: (map: Beatmap) => void;
  /** The administrator-defined submission rules (C8, C9). Null until the first read. */
  settings: ApiSiteSettings | null;
  /**
   * A difficulty the player already chose on the dashboard, as an osu! difficulty id.
   *
   * When it is set the page opens on the favorites tab with that row selected, so "Submit" on a
   * favorite card lands on the requirement pickers rather than on an empty URL box. It is only a
   * starting point: the tab resolves it against the favorites it holds, and every validation and
   * eligibility rule is the same one the manual path goes through.
   */
  preselectedDifficultyId?: number | null;
  loading: boolean;
  onSubmitted: (submission: ApiSubmission) => void;
  /** Resolves to an error message, or null once the entry is withdrawn. */
  onWithdraw: () => Promise<string | null>;
  onNavigate: (page: PlatformPage) => void;
  user: AuthUser | null;
  onLogin?: () => void;
}

export function PlatformSubmitPage({
  round,
  favorites,
  onFavorite,
  settings,
  preselectedDifficultyId,
  mySubmission,
  loading,
  onSubmitted,
  onWithdraw,
  onNavigate,
  user,
  onLogin,
}: PlatformSubmitPageProps) {
  // 'url' by default, because pasting a link is the path that always works — a player with no
  // favorites has nothing to pick from.
  const [tab, setTab] = useState<SubmitTab>('url');

  /**
   * A handoff from the dashboard opens the favorites tab, since that is where the chosen beatmap
   * lives. Keyed on the id alone, so switching tabs by hand afterwards is not overridden on every
   * re-render — and App drops the handoff on leaving the page, so coming back later opens clean.
   */
  useEffect(() => {
    if (preselectedDifficultyId !== null && preselectedDifficultyId !== undefined) {
      setTab('favorites');
    }
  }, [preselectedDifficultyId]);
  // Same table the nav and the vote page read, so "closed" means one thing.
  const access = pageAccess('submit', round);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 pb-16">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono mb-1">{roundLabel(round)}</p>
        <h1 className="text-2xl font-black text-white mb-2 tracking-tight">Submit a Beatmap</h1>
        <p className="text-sm text-slate-400">
          Propose a beatmap for this month's community vote. The winner becomes the monthly challenge.
        </p>
      </div>

      {!user ? (
        <LoginGate onLogin={onLogin} />
      ) : access.state !== 'open' ? (
        <PhaseGate access={access} round={round} onNavigate={onNavigate} />
      ) : !user.canSubmit ? (
        // Before C5 an ineligible player was shown the whole form and learned the answer
        // from a 403 after picking a beatmap and its requirements. canSubmit is the
        // server's own verdict, so the page can say so up front.
        <IneligibleGate />
      ) : loading ? (

        <div className="flex items-center gap-3 py-16 justify-center text-slate-600">
          <span className="w-4 h-4 border-2 border-slate-700 border-t-slate-400 rounded-full animate-spin" />
          <span className="text-sm">Checking your submission…</span>
        </div>
      ) : mySubmission ? (
        <MySubmission submission={mySubmission} onWithdraw={onWithdraw} />
      ) : (
        <>
          <EligibilityPanel settings={settings} />

          {/* Tabs */}
          <div className="flex gap-1 mb-8 p-1 bg-slate-900/60 border border-slate-800 rounded-xl w-fit">
            <button
              type="button"
              onClick={() => setTab('url')}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all ${
                tab === 'url'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Link className="w-3.5 h-3.5" />
              Beatmap URL
            </button>
            <button
              type="button"
              onClick={() => setTab('favorites')}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all ${
                tab === 'favorites'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Heart className="w-3.5 h-3.5" />
              My Favorites
            </button>
          </div>

          {tab === 'url'       && <UrlTab onSubmitted={onSubmitted} settings={settings} />}
          {tab === 'favorites' && (
            <FavoritesTab
              favorites={favorites}
              onFavorite={onFavorite}
              onSubmitted={onSubmitted}
              settings={settings}
              preselectedDifficultyId={preselectedDifficultyId}
            />
          )}
        </>
      )}
    </div>
  );
}
