import React from 'react';
import { Phase, PlatformPage } from '../../types';
import { CurrentRound, formatDeadline, PageAccess, PHASE_LANDING, roundLabel } from '../../lib/round';
import { Lock, Clock, CalendarX, ArrowRight } from 'lucide-react';

// ── PHASE GATE ───────────────────────────────────────────────────────────────
//
// The one closed-state panel for every phase-gated page. It replaced a per-page
// component that hardcoded "Round 2 · September 2026" as the next window, so this
// one reads the real round instead and says nothing it cannot know.

/** Kept as a table rather than built from the phase name, so the verbs agree. */
const HEADING: Record<Phase, { early: string; closed: string }> = {
  submission: { early: 'Submissions have not opened yet', closed: 'Submissions are closed' },
  voting: { early: 'Voting has not opened yet', closed: 'Voting is closed' },
  challenge: { early: 'The challenge has not started', closed: 'The challenge is over' },
};

const LANDING_LABEL: Record<PlatformPage, string> = {
  dashboard: 'Back to Dashboard',
  submit: 'Go to Submit',
  vote: 'Go to Vote',
  search: 'Go to Search',
  rankings: 'Go to Rankings',
  admin: 'Go to Admin',
  archive: 'Go to Archive',
};

interface PhaseGateProps {
  access: PageAccess;
  round: CurrentRound | null;
  onNavigate: (page: PlatformPage) => void;
}

/** Renders nothing when the page is open, so callers can mount it unconditionally. */
export function PhaseGate({ access, round, onNavigate }: PhaseGateProps) {
  if (access.state === 'open') return null;

  const noRound = access.state === 'no-round';
  const heading = noRound
    ? 'No round is open'
    : HEADING[access.required][access.state === 'early' ? 'early' : 'closed'];

  // Where the round actually is right now, so the panel never guesses.
  const landing = round ? PHASE_LANDING[round.phase] : 'dashboard';
  const scheduled = round ? round.schedule[access.required] : null;

  return (
    <div className="flex flex-col items-center gap-6 py-20 text-center">
      <div className="w-20 h-20 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
        {noRound ? (
          <CalendarX className="w-9 h-9 text-slate-600" />
        ) : access.state === 'early' ? (
          <Clock className="w-9 h-9 text-slate-600" />
        ) : (
          <Lock className="w-9 h-9 text-slate-600" />
        )}
      </div>

      <div>
        <h2 className="text-2xl font-black text-white mb-2">{heading}</h2>
        <p className="text-slate-400 max-w-md text-sm leading-relaxed">
          {noRound
            ? 'Nothing is running at the moment. A new round opens each month.'
            : `${roundLabel(round)} is in the ${access.actual} phase.`}
        </p>
      </div>

      {!noRound && (
        <div className="bg-[#0d1526] border border-slate-800 rounded-2xl px-6 py-4 text-left space-y-2 w-full max-w-sm">
          <p className="text-[10px] uppercase tracking-widest text-slate-600 font-mono">
            {access.state === 'early' ? 'Scheduled' : 'Was scheduled'}
          </p>
          <p className="text-sm text-slate-300">
            The {access.required} phase {access.state === 'early' ? 'ends' : 'ended'}{' '}
            <span className="text-amber-400 font-bold">{formatDeadline(scheduled)}</span>
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => onNavigate(landing)}
        className="flex items-center gap-2 px-6 py-2.5 bg-slate-800 border border-slate-700 hover:border-slate-600 text-slate-200 text-sm font-bold rounded-xl transition-all"
      >
        {LANDING_LABEL[landing]}
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
