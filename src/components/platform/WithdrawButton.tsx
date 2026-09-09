import React, { useState } from 'react';
import { AlertCircle, Trash2, X } from 'lucide-react';

// ── WITHDRAW BUTTON ──────────────────────────────────────────────────────────
//
// Shared by the submit page's MySubmission panel and the dashboard's
// YourSubmission panel, because both show the same entry and both should be able
// to take it back.
//
// Two steps on purpose. One click deleting a round entry is harsh for something
// that cannot be undone — the row is gone, and re-entering means pasting the URL
// and picking the requirements again.

interface WithdrawButtonProps {
  /** Resolves to an error message, or null when the entry was withdrawn. */
  onWithdraw: () => Promise<string | null>;
}

export function WithdrawButton({ onWithdraw }: WithdrawButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    const message = await onWithdraw();
    // On success this panel unmounts with the entry, so only failure resets state.
    if (message !== null) {
      setError(message);
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-2">
      {error && (
        <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-px" />
          <p className="text-[11px] text-rose-300 flex-1">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
          >
            <X className="w-3 h-3 text-rose-300" />
          </button>
        </div>
      )}

      {confirming ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-2.5 space-y-2.5">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Withdrawing removes your entry from this round. You can submit again while
            submissions are open, but you will have to pick the beatmap and requirements
            again.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => { void run(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <Trash2 className="w-3 h-3" />
              {busy ? 'Withdrawing…' : 'Confirm withdrawal'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-slate-400 hover:text-slate-200 disabled:opacity-30 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-rose-300 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Withdraw this entry
        </button>
      )}
    </div>
  );
}
