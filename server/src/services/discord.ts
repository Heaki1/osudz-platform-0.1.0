// Discord announcements.
//
// DISCORD_WEBHOOK was declared in .env.example for "phase / winner announcements" and
// read by nothing, which is a trap for the next person: a configured-looking variable
// that does nothing looks like a broken integration rather than an absent one.
//
// Everything here is fire-and-forget and swallows its own failures. An announcement is
// a courtesy, and Discord being slow or down must never fail the write that triggered
// it — an administrator approving a winner cannot be told the approval failed because a
// webhook timed out. Unset webhook means silence, which is the supported configuration.

const WEBHOOK = process.env.DISCORD_WEBHOOK?.trim() ?? '';

/**
 * Whether announcements will actually go anywhere. Exported as a boolean, never the URL: the
 * admin config tab needs to know that a webhook is set, and a secret should not travel over
 * HTTP to answer that.
 */
export const isConfigured = (): boolean => WEBHOOK !== '';

/** Whether announcements are configured at all. Exported so callers can skip the work. */
export const announcementsEnabled = (): boolean => WEBHOOK !== '';

/**
 * Posts one line to the configured channel. Never throws and never resolves to an
 * error: the caller does not wait on it and has nothing to do about a failure.
 */
export function announce(content: string): void {
  if (WEBHOOK === '') return;

  // Not awaited on purpose. The catch is what keeps an unhandled rejection out of the
  // process when the webhook is unreachable.
  void fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // allowed_mentions none: a round announcement should never ping a whole server.
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  }).catch((err: unknown) => {
    console.error('[discord] announcement failed:', err instanceof Error ? err.message : err);
  });
}

/** "Round 4 · September 2026" — the same label the client shows. */
const label = (round: { round_number: number; month: string; year: number }): string =>
  `Round ${round.round_number} · ${round.month} ${round.year}`;

export function announcePhase(
  round: { round_number: number; month: string; year: number },
  phase: string,
  automatic: boolean
): void {
  const how = automatic ? 'on schedule' : 'by an administrator';
  const line =
    phase === 'voting'
      ? `🗳️ **${label(round)}** — submissions are closed and voting is open (${how}).`
      : phase === 'challenge'
        ? `🎮 **${label(round)}** — the winner is official and the challenge has begun.`
        : phase === 'ended'
          ? `📦 **${label(round)}** — the round is over and has been archived (${how}).`
          : `**${label(round)}** — now in the ${phase} phase (${how}).`;
  announce(line);
}

/**
 * A round ended with nothing to vote on.
 *
 * Its own announcement rather than announcePhase's archive line, which would say the round
 * "is over and has been archived" and leave the community to guess why. A month with no
 * entries is worth saying out loud — it is the one outcome where there is no winner to
 * announce later and no challenge to join.
 */
export function announceVotingSkipped(
  round: { round_number: number; month: string; year: number }
): void {
  announce(
    `📭 **${label(round)}** — no entries were approved, so there was nothing to vote on. ` +
      'An administrator has closed the round with no winner and no challenge.'
  );
}

export function announceBallotClosed(
  round: { round_number: number; month: string; year: number },
  outcome: { tied: number[]; votes: number | null; total: number | null }
): void {
  const tally =
    outcome.votes === null
      ? ''
      : ` on ${outcome.votes}${outcome.total === null ? '' : ` of ${outcome.total}`} votes`;

  announce(
    outcome.tied.length > 1
      ? `⚖️ **${label(round)}** — voting has closed and ${outcome.tied.length} entries are level${tally}. An administrator will pick the winner.`
      : `🔒 **${label(round)}** — voting has closed${tally}. The winner is awaiting approval.`
  );
}

export function announceWinner(
  round: { round_number: number; month: string; year: number },
  winner: { title: string; artist: string; difficulty_name: string; submitted_by_name: string } | null
): void {
  announce(
    winner
      ? `👑 **${label(round)}** — the winner is **${winner.artist} - ${winner.title} [${winner.difficulty_name}]**, submitted by ${winner.submitted_by_name}. The challenge starts now.`
      : `👑 **${label(round)}** — a winner has been approved and the challenge starts now.`
  );
}

/**
 * A corrected result (D4).
 *
 * Its own message rather than reusing announceWinner: that one says "the challenge starts
 * now", which is untrue for a correction, and a community that was already told the previous
 * answer needs to hear that it changed and why — otherwise the wrong winner stands everywhere
 * except the database.
 */
export function announceCorrection(
  round: { round_number: number; month: string; year: number },
  winner: { title: string; artist: string; difficulty_name: string; submitted_by_name: string } | null,
  reason: string
): void {
  announce(
    winner
      ? `⚠️ **${label(round)}** — the recorded result has been corrected by an administrator. The winner is now **${winner.artist} - ${winner.title} [${winner.difficulty_name}]**, submitted by ${winner.submitted_by_name}. Reason: ${reason}`
      : `⚠️ **${label(round)}** — the recorded result has been corrected by an administrator. Reason: ${reason}`
  );
}
