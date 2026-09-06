import React from 'react';
import { Phase, PlatformPage } from '../../types';
import { CurrentRound, isBallotOpen, isPageOpen, useCountdown } from '../../lib/round';
import { Home, Upload, Trophy, Search, Shield, LogOut, ChevronDown, Archive, BarChart2 } from 'lucide-react';

export interface AuthUser {
  /** The osu!DZ account id, so a page can tell which leaderboard row is the caller's. */
  id: number;
  username: string;
  rank: number | null;
  country: string;
  /** Mirrors ApiUser.isAdmin, derived server-side from ADMIN_OSU_IDS. */
  isAdmin: boolean;
  /** Mirrors ApiUser.canVote — the server's own eligibility verdict, not a guess. */
  canVote: boolean;
  /**
   * Mirrors ApiUser.canSubmit. Separate from canVote because an administrator controls
   * the two independently (C5), so neither can be derived from the other.
   */
  canSubmit: boolean;
  /** Mirrors ApiUser.canChallenge — whether this account may compete for the prize. */
  canChallenge: boolean;
}

// osu! reports no global_rank for unranked or inactive accounts.
const formatRank = (rank: number | null) => (rank === null ? 'unranked' : `#${rank.toLocaleString()}`);

/** Exported so a page can label its own phase from the same table as the nav badge. */
export const phaseConfig: Record<Phase, { label: string; color: string; bar: string; badgeBg: string; badgeBorder: string; dot: string }> = {
  submission: {
    label: 'SUBMISSION PHASE',
    color: 'text-amber-400',
    bar: 'bg-amber-400',
    badgeBg: 'bg-amber-400/10',
    badgeBorder: 'border-amber-400/25',
    dot: 'bg-amber-400',
  },
  voting: {
    label: 'VOTING PHASE',
    color: 'text-blue-400',
    bar: 'bg-blue-500',
    badgeBg: 'bg-blue-500/10',
    badgeBorder: 'border-blue-500/25',
    dot: 'bg-blue-400',
  },
  challenge: {
    label: 'CHALLENGE PHASE',
    color: 'text-purple-400',
    bar: 'bg-purple-500',
    badgeBg: 'bg-purple-500/10',
    badgeBorder: 'border-purple-500/25',
    dot: 'bg-purple-400',
  },
};

const navItems: { key: PlatformPage; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <Home className="w-4 h-4" /> },
  { key: 'submit',    label: 'Submit',    icon: <Upload className="w-4 h-4" /> },
  { key: 'vote',      label: 'Vote',      icon: <Trophy className="w-4 h-4" /> },
  { key: 'search',    label: 'Search',    icon: <Search className="w-4 h-4" /> },
  { key: 'rankings',  label: 'Rankings',  icon: <BarChart2 className="w-4 h-4" /> },
  { key: 'archive',   label: 'Archive',   icon: <Archive className="w-4 h-4" /> },
];

interface NavHeaderProps {
  page: PlatformPage;
  phase: Phase;
  round: CurrentRound | null;
  onNavigate: (page: PlatformPage) => void;
  user?: AuthUser | null;
  onLogin?: () => void;
  onLogout?: () => void;
  /** Ends every session this account holds (G6), not just this browser's. */
  onLogoutEverywhere?: () => void;
}

export function NavHeader({
  page,
  phase,
  round,
  onNavigate,
  user,
  onLogin,
  onLogout,
  onLogoutEverywhere,
}: NavHeaderProps) {
  const cfg = phaseConfig[phase];
  const countdown = useCountdown(round?.endsAt);
  /**
   * The ballot closes on winnerStatus while the phase stays 'voting', so the badge
   * asks the same question the vote page does rather than trusting the phase. Without
   * this it reads "VOTING PHASE · Ends in ended" on every page, with a pulsing dot,
   * while the round is actually waiting on an administrator.
   */
  const frozen = round?.phase === 'voting' && !isBallotOpen(round);

  return (
    <header className="sticky top-0 z-50 bg-[#060c18]/95 backdrop-blur-md border-b border-slate-800/70">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0 mr-4">
          <div className="w-7 h-7 rounded-lg bg-amber-400 flex items-center justify-center flex-shrink-0">
            <span className="text-slate-950 font-black text-xs leading-none tracking-tighter">dz</span>
          </div>
          <div className="leading-none whitespace-nowrap">
            <span className="text-white font-black text-[15px] tracking-tight">osu</span>
            <span className="text-amber-400 font-black text-[15px]">dz</span>
            <span className="text-slate-600 font-mono text-[11px]">.ppy</span>
          </div>
        </div>

        {/* Nav tabs */}
        <nav className="flex items-stretch h-16">
          {navItems.map(({ key, label, icon }) => {
            // Out-of-phase pages stay reachable — the vote page is worth reading when
            // you cannot vote — but they are dimmed so the tab and the closed panel
            // behind it agree. Both read PAGE_PHASE in lib/round.ts.
            const open = isPageOpen(key, round);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onNavigate(key)}
                title={open ? undefined : `${label} is not open in this phase`}
                className={`flex items-center gap-2 px-4 h-full text-[13px] font-bold tracking-wide border-b-2 transition-all -mb-px ${
                  page === key
                    ? 'border-amber-400 text-amber-400'
                    : open
                      ? 'border-transparent text-slate-400 hover:text-slate-200'
                      : 'border-transparent text-slate-600 hover:text-slate-400'
                }`}
              >
                {icon}
                {label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Phase badge — driven by the round; without one there is nothing to count down to. */}
        {round ? (
          <div
            className={`hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-full border ${
              frozen ? 'border-slate-700 bg-slate-800/40' : `${cfg.badgeBorder} ${cfg.badgeBg}`
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${frozen ? 'bg-slate-500' : `${cfg.dot} animate-pulse`}`} />
            <span
              className={`text-[10px] font-black tracking-widest uppercase font-mono ${
                frozen ? 'text-slate-400' : cfg.color
              }`}
            >
              {frozen ? 'VOTING CLOSED' : cfg.label}
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-[10px] text-slate-400 font-mono">
              {frozen
                ? round.winnerStatus === 'tiebreak'
                  ? 'tie unresolved'
                  : 'winner pending'
                : `Ends in ${countdown}`}
            </span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-full border border-slate-700 bg-slate-800/40">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
            <span className="text-[10px] font-black tracking-widest uppercase font-mono text-slate-500">
              No active round
            </span>
          </div>
        )}

        {/* Auth */}
        {user ? (
          <div className="flex items-center gap-2 group relative">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all cursor-default">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center flex-shrink-0">
                <span className="text-slate-950 font-black text-[10px] leading-none">
                  {user.username[0].toUpperCase()}
                </span>
              </div>
              <div className="leading-none">
                <p className="text-[12px] font-bold text-white">{user.username}</p>
                <p className="text-[9px] text-slate-500 font-mono">{formatRank(user.rank)}</p>
              </div>
              <ChevronDown className="w-3 h-3 text-slate-500" />
            </div>
            {/* Dropdown */}
            <div className="absolute top-full right-0 mt-2 w-44 bg-[#0d1526] border border-slate-800 rounded-xl shadow-xl z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
              <div className="px-4 py-3 border-b border-slate-800">
                <p className="text-xs font-bold text-white">{user.username}</p>
                <p className="text-[10px] text-slate-500">{user.country} · {formatRank(user.rank)}</p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-400 hover:text-rose-400 hover:bg-rose-500/5 transition-all text-left"
              >
                <LogOut className="w-3.5 h-3.5" />
                Log out
              </button>
              {/* G6. A stolen cookie is valid for thirty days and the plain logout cannot
                  reach it, so this is the only control that actually ends it. */}
              <button
                type="button"
                onClick={onLogoutEverywhere}
                title="Signs out every browser and device this account is logged in on."
                className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-500 hover:text-rose-400 hover:bg-rose-500/5 transition-all text-left border-t border-slate-800"
              >
                <LogOut className="w-3.5 h-3.5" />
                Log out everywhere
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onLogin}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800 border border-slate-700 hover:border-amber-400/40 hover:bg-amber-400/5 text-slate-200 hover:text-white text-[13px] font-bold transition-all"
          >
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex-shrink-0" />
            Login with osu!
          </button>
        )}

        {/* Admin link — hidden for everyone else. Convenience only; the real gate
            is requireAdmin on every /api/admin route. */}
        {user?.isAdmin && (
          <button
            type="button"
            onClick={() => onNavigate('admin')}
            title="Admin Dashboard"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all flex-shrink-0 ${
              page === 'admin'
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                : 'bg-slate-900/60 border-slate-800 text-slate-600 hover:text-slate-400'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Admin
          </button>
        )}
      </div>

      {/* Phase color strip */}
      <div className={`h-[2px] ${round ? cfg.bar : 'bg-slate-700'} opacity-50`} />
    </header>
  );
}
