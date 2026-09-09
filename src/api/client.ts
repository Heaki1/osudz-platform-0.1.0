// Typed API seam — all fetch calls go through here.
//
// Two return conventions, one rule. Reads resolve to `T | null`: a failed read is
// indistinguishable from "no data", and every caller has a fallback. Writes
// resolve to `ApiResult<T>` so the caller can tell success from failure and show
// the reason — silently swallowing a failed write leaves an admin clicking a
// button that does nothing.

export interface ApiUser {
  id: number;
  osuId: number;
  username: string;
  country: string;
  avatarUrl: string;
  /** osu! global rank at last login; null for unranked accounts. */
  globalRank: number | null;
  isAdmin: boolean;
  /**
   * Whether this account may vote. Computed server-side by the same function the gate
   * that refuses the write uses, so the client never re-derives eligibility from
   * `country` and cannot drift from it.
   */
  canVote: boolean;
  /**
   * Whether this account may submit. Separate from canVote because an administrator
   * controls the two independently (C5) — a blocked voter may still be able to enter a
   * beatmap, and the reverse.
   */
  canSubmit: boolean;
  /**
   * Whether this account may post a challenge score. DERIVED from the two capabilities
   * above rather than stored: the country rule decides unless an administrator has blocked
   * or granted BOTH, which is the only unambiguous statement about taking part. See
   * canEnterChallenge in server/src/repo/users.ts.
   */
  canChallenge: boolean;
}

export interface ApiRound {
  id: number;
  roundNumber: number;
  phase: "submission" | "voting" | "challenge" | "ended";
  month: string;
  year: number;
  reward: string;
  /**
   * Scheduled phase ends, ISO 8601. Null when the round was created without
   * durations. These are a schedule, not a clock: advancing a phase early leaves
   * the later ends where they were unless the admin overrides them.
   */
  submissionEndsAt: string | null;
  votingEndsAt: string | null;
  challengeEndsAt: string | null;
  /**
   * How far this round's winner has got. The phase stays 'voting' while the winner
   * is 'pending' or 'tiebreak', so this is what says whether the ballot is open.
   */
  winnerStatus: "none" | "pending" | "tiebreak" | "official";
  /** Null until the winner is determined, and while a tie is unresolved. */
  winningSubmissionId: number | null;
  /** Frozen when voting closed. On a tie, the count each tied entry reached. */
  winnerVoteCount: number | null;
  /** Votes cast in the round, frozen alongside winnerVoteCount. */
  totalVotes: number | null;
  winnerApprovedAt: string | null;
  /**
   * When this round's DZPP was frozen, or null when it never was — the admin recompute panel
   * needs to tell "scored" from "never scored", and a round can be finalized to zero rows.
   */
  dzppFinalizedAt: string | null;
}

/**
 * A round with everything the archive shows. Served by GET /rounds and GET /rounds/:id;
 * GET /rounds/current stays lean, because every page loads that one on every render.
 */
export interface ApiRoundDetail extends ApiRound {
  /**
   * The recorded winner, pending or official — winnerStatus says which. Null when
   * nothing is recorded yet, and while a tie is unresolved.
   */
  winner: ApiSubmission | null;
  /**
   * That round's challenge scores, in the order the server ordered them for this
   * round's own challenge requirement. Never re-sort them on the client.
   */
  leaderboard: ApiChallengeScore[];
  /** Distinct people who entered, voted, or posted a challenge score in this round. */
  participants: number;
}

export type MapStatus = "ranked" | "loved" | "approved";

export interface ApiSubmission {
  id: number;
  beatmapsetId: number;
  difficultyId: number;
  title: string;
  artist: string;
  mapper: string;
  difficultyName: string;
  /** The beatmap's own osu! status. Distinct from reviewStatus below. */
  mapStatus: MapStatus;
  coverUrl: string;
  previewUrl: string;
  stars: number;
  bpm: number;
  /** Display string ("2:19"); the column stores seconds. */
  length: string;
  cs: number;
  ar: number;
  od: number;
  hp: number;
  challengeRequirement: string;
  modRequirement: string;
  submittedByName: string;
  voteCount: number;
  /** Admin review state. Only 'approved' rows come back from GET /submissions. */
  reviewStatus: "pending" | "approved" | "rejected";
  submittedAt: string;
  isFavorited?: boolean;
}

/**
 * What the server reads off the osu! API for a pasted URL. Not a submission yet —
 * it has no id, and the row is built from a fresh lookup at submit time rather
 * than from this.
 */
export interface ApiBeatmapPreview {
  difficultyId: number;
  beatmapsetId: number;
  title: string;
  artist: string;
  mapper: string;
  difficultyName: string;
  mapStatus: MapStatus;
  coverUrl: string;
  previewUrl: string;
  stars: number;
  bpm: number;
  lengthSeconds: number;
  cs: number | null;
  ar: number | null;
  od: number | null;
  hp: number | null;
}

/**
 * One beatmap search hit.
 *
 * A hit is a beatmapSET, represented by its hardest difficulty — `difficultyCount` says
 * how many the set has, so a card can be honest about showing one of several rather
 * than implying the set is a single map.
 */
export interface ApiSearchHit {
  difficultyId: number;
  beatmapsetId: number;
  title: string;
  artist: string;
  mapper: string;
  difficultyName: string;
  mapStatus: MapStatus;
  coverUrl: string;
  previewUrl: string;
  stars: number;
  bpm: number;
  lengthSeconds: number;
  difficultyCount: number;
}

/**
 * One player's play on a round's winning beatmap.
 *
 * `qualified` is what the play can be judged on by itself — the required mods, and a
 * full combo where that was the requirement. The other three challenge requirements
 * are relative, so they are expressed by the order the server returns rather than by
 * this flag; see server/src/repo/challengeScores.ts.
 */
export interface ApiChallengeScore {
  /** 1-based position in the order the server returned. 0 for a single score read. */
  rank: number;
  userId: number;
  osuId: number;
  username: string;
  avatarUrl: string;
  score: number;
  /** A percentage, 0-100. */
  accuracy: number;
  misses: number;
  /** Joined acronyms ('HDHR'), or 'NM'. */
  mods: string;
  qualified: boolean;
  /**
   * DZPP this play is worth as the round stands, or null when the read could not know it —
   * a single-score read has no field size, and an archived round's real answer is the frozen
   * row rather than a recomputation.
   *
   * PROVISIONAL while the challenge is open: placement and the field factor both move as
   * scores arrive. The server computes it with the same engine that freezes round_dzpp, so it
   * is never a second formula.
   */
  dzpp: number | null;
  /** Null when an administrator entered this by hand rather than importing it. */
  osuScoreId: number | null;
  submittedAt: string;
}

/**
 * One row of the DZ Performance Rankings.
 *
 * Algeria only. The filter runs inside the query in server/src/repo/dzpp.ts, so a player
 * outside the ranking never reaches this shape at all.
 */
export interface ApiRankingEntry {
  /** Shared by players level on points, the way osu!'s own rankings do it. */
  rank: number;
  userId: number;
  osuId: number;
  username: string;
  avatarUrl: string;
  country: string;
  /** Cumulative DZPP — a plain sum of every frozen round in the selected period. */
  dzpp: number;
  roundsPlayed: number;
  firstPlaces: number;
  /** Null for a player who has never qualified in a counted round. */
  bestPlacement: number | null;
}

/**
 * A page of the ranking.
 *
 * An envelope rather than the bare array every other read here returns, because a bare array
 * cannot carry the total, and a pager that does not know how many pages exist is a pager that
 * guesses.
 */
export interface ApiRankingPage {
  page: number;
  pageSize: number;
  /** Players in the whole filtered table, not on this page. */
  total: number;
  /** Seasons that actually hold DZPP, newest first — the year selector's options. */
  years: number[];
  entries: ApiRankingEntry[];
}

/**
 * One frozen round in a player's DZPP history, with the whole breakdown.
 *
 * The terms travel with the total on purpose: a table of totals with no visible derivation is
 * a table people argue with rather than chase.
 */
export interface ApiPlayerDzppRound {
  roundId: number;
  roundNumber: number;
  month: string;
  year: number;
  /** osu! pp for the play. Null when osu! reported none — a Loved map, or unranked mods. */
  performanceValue: number | null;
  completionPoints: number;
  qualificationPoints: number;
  /** Already multiplied by the field factor. */
  placementPoints: number;
  /** Null when the play did not qualify — only qualified players are placed. */
  placement: number | null;
  qualified: boolean;
  /** Qualified players in the round: the field factor's input. */
  fieldSize: number;
  finalDzpp: number;
}

/**
 * One vote with the account that cast it — GET /admin/votes only.
 *
 * Ballot secrecy is a rule, not an oversight: no public endpoint carries voter identity,
 * and this shape exists so an administrator can investigate a dispute. Do not reuse it
 * on a public surface.
 */
export interface ApiVoteAudit {
  voteId: number;
  userId: number;
  username: string;
  osuId: number;
  avatarUrl: string;
  country: string;
  submissionId: number;
  submissionTitle: string;
  submissionArtist: string;
  difficultyName: string;
  castAt: string;
  /**
   * When the vote was last moved (B9). Equal to castAt until it is moved, so a vote that
   * changed is distinguishable from one that was cast and left alone.
   *
   * Only the time is recorded, not the previous choice — that would need a history table.
   */
  movedAt: string;
}


/**
 * One country on the submit-and-vote allowlist.
 *
 * A row with enabled false is kept rather than deleted: it records that an administrator
 * considered the country and refused it, which an absent row does not say. The country
 * NAME is not stored — the client derives it from the code with Intl.DisplayNames, so
 * adding a country is two letters rather than a code change.
 */
export interface ApiAllowedCountry {
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  enabled: boolean;
  /** The administrator who last changed this decision; null if their account is gone. */
  addedBy: number | null;
  addedAt: string;
}

/**
 * A per-player permission override — the "exception" an administrator sets after an
 * investigation (C5).
 *
 * Each flag is THREE-VALUED: null means no override for that capability, so the country
 * allowlist decides it; true grants it; false refuses it. An override wins in both
 * directions, which is why this is not a ban list.
 */
export interface ApiParticipantOverride {
  canSubmit: boolean | null;
  canVote: boolean | null;
  note: string | null;
  setBy: number | null;
  setAt: string | null;
}

/**
 * One account as the admin Users tab sees it.
 *
 * canSubmit and canVote are the EFFECTIVE answers — what the gates would actually decide.
 * `countryAllowed` and `override` are the two inputs that produced them, so the tab can
 * show why an account is allowed rather than guessing at it.
 */
export interface ApiAdminUser {
  id: number;
  osuId: number;
  username: string;
  country: string;
  avatarUrl: string;
  globalRank: number | null;
  isAdmin: boolean;
  canSubmit: boolean;
  canVote: boolean;
  /** The effective challenge answer, so the tab can show that a full block reached it. */
  canChallenge: boolean;
  countryAllowed: boolean;
  override: ApiParticipantOverride | null;
}

/** One override with the account it applies to, for the Eligibility tab's exception list. */
export interface ApiParticipantException extends ApiParticipantOverride {
  userId: number;
  username: string;
  osuId: number;
  country: string;
  avatarUrl: string;
  /** The administrator who set it, by name; null if their account is gone. */
  setByName: string | null;
  setAt: string;
}

/**
 * One favorited beatmap.
 *
 * TWO SOURCES, ONE LIST. 'dz' is a map favorited on this site, 'osu' is one imported from
 * the player's osu! profile. They are presented together and distinguished by source; an
 * import never overwrites a 'dz' row, which the primary key enforces server-side.
 *
 * mapStatus is a plain string here, unlike everywhere else: a favorite may be graveyard or
 * pending, because the ranked-status rule belongs to the submit path.
 */
export interface ApiFavorite {
  difficultyId: number;
  beatmapsetId: number;
  source: "dz" | "osu";
  title: string;
  artist: string;
  mapper: string;
  difficultyName: string;
  mapStatus: string;
  coverUrl: string;
  previewUrl: string;
  stars: number;
  bpm: number;
  lengthSeconds: number;
  favoritedAt: string;
}

/**
 * The administrator-defined submission rules (C8 and C9).
 *
 * A null bound means no bound — which is what migration 011 seeded, so nothing changed on the
 * day the store landed. The three lists are what the submit page offers and what the server
 * validates against, so they cannot drift the way the hardcoded copies did.
 */
export interface ApiSiteSettings {
  minStars: number | null;
  maxStars: number | null;
  minLengthSeconds: number | null;
  maxLengthSeconds: number | null;
  allowedStatuses: string[];
  allowedMods: string[];
  allowedChallengeTypes: string[];
}

/** The same rules plus who last changed them — GET /api/admin/settings only. */
export interface ApiAdminSiteSettings extends ApiSiteSettings {
  updatedBy: number | null;
  updatedAt: string;
}

/**
 * Read-only server configuration, for the admin config tab.
 *
 * Booleans and counts, never the values: the Discord webhook and the admin id list are
 * credentials, and an endpoint that returned them would put a secret on the wire to answer a
 * question that only needs a yes.
 */
export interface ApiAdminConfig {
  discordConfigured: boolean;
  clientOrigin: string;
  publicBaseUrl: string;
  secureCookies: boolean;
  adminCount: number;
}

/**
 * One administrator correction of a recorded result (D4).
 *
 * The only way a recorded winner ever changes. Append-only: the previous entry stays named
 * here rather than being overwritten, so a round corrected twice keeps both steps.
 */
/**
 * One audited DZPP recompute of one round.
 *
 * Append-only on the server: a row records what a round used to be worth so the change stays
 * legible, which is the whole reason freezing a round is safe.
 */
export interface ApiDzppRecompute {
  id: number;
  roundId: number;
  roundNumber: number;
  previousRows: number;
  newRows: number;
  previousTotal: number;
  newTotal: number;
  /** Null when the round had never been scored — a missed finalization, not a rescore. */
  previousFormulaVersion: number | null;
  newFormulaVersion: number;
  reason: string;
  recomputedBy: number | null;
  recomputedByName: string | null;
  recomputedAt: string;
}

/** What a recompute changed, returned by the write itself. */
export interface ApiDzppRecomputeSummary {
  roundId: number;
  previousRows: number;
  newRows: number;
  previousTotal: number;
  newTotal: number;
  previousFormulaVersion: number | null;
  newFormulaVersion: number;
  /** True when the round held no frozen rows at all before the call. */
  firstTime: boolean;
}

export interface ApiResultCorrection {
  id: number;
  roundId: number;
  previousSubmissionId: number | null;
  previousTitle: string | null;
  newSubmissionId: number | null;
  newTitle: string | null;
  previousWinnerStatus: string;
  reason: string;
  correctedBy: number | null;
  correctedByName: string | null;
  correctedAt: string;
}

/**
 * One message in the challenge-phase live chat.
 *
 * Scoped to one round. Never archived. Admins can delete any message.
 */
export interface ApiChatMessage {
  id: number;
  roundId: number;
  userId: number;
  username: string;
  avatarUrl: string;
  /** True when the author is an administrator — shown with a badge in the UI. */
  isAdmin: boolean;
  body: string;
  createdAt: string;
}

/**
 * One comment on a submission (B8).
 *
 * parentId is the comment being replied to, or null for a top-level one. The panel renders a
 * reply directly under its parent rather than a tree, so one level is what the shape supports
 * in practice even though the column would allow more.
 */
export interface ApiComment {
  id: number;
  submissionId: number;
  parentId: number | null;
  userId: number;
  username: string;
  avatarUrl: string;
  body: string;
  createdAt: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

const BASE = "/api";

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function send<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Not every response carries JSON — 501 stubs and proxy errors may not.
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : `Request failed (${res.status})`;
      return { ok: false, status: res.status, error: message };
    }

    return { ok: true, data: payload as T };
  } catch {
    return { ok: false, status: 0, error: "Cannot reach the API — is the server running?" };
  }
}

export const api = {
  // ── Auth ───────────────────────────────────────────────────────────────────
  auth: {
    me: () => get<ApiUser>("/auth/me"),
    loginUrl: () => `${BASE}/auth/login`,
    logout: () => send<{ ok: boolean }>("POST", "/auth/logout"),
    /**
     * Ends every session this account holds (G6). Plain logout only clears this browser's
     * cookie; a copy taken from another device would stay valid for its full thirty days.
     *
     * The caller keeps a fresh cookie for the tab they clicked in — ending your other sessions
     * and ending this one are different intentions, and the second already has a button.
     */
    logoutEverywhere: () => send<{ ok: boolean }>("POST", "/auth/logout-all"),
  },

  // ── Rounds ─────────────────────────────────────────────────────────────────
  rounds: {
    /** Resolves to null both when no round is open and when the API is down. */
    current: () => get<ApiRound>("/rounds/current"),
    /** Every round, newest first, with winner, leaderboard and participants. */
    list: () => get<ApiRoundDetail[]>("/rounds"),
    /** One round, in the same shape as the list. */
    get: (id: number) => get<ApiRoundDetail>(`/rounds/${id}`),
  },

  // ── Submissions ────────────────────────────────────────────────────────────
  submissions: {
    /** Approved entries in the open round; [] when no round is open. */
    list: () => get<ApiSubmission[]>("/submissions"),
    get: (id: number) => get<ApiSubmission>(`/submissions/${id}`),
    /** The caller's own entry, pending included — GET /submissions hides it. */
    mine: () => get<ApiSubmission | null>("/submissions/mine"),
    /** Resolves a pasted osu! URL to beatmap metadata for the preview card. */
    lookup: (url: string) => send<ApiBeatmapPreview>("POST", "/submissions/lookup", { url }),
    /** Withdraws the caller's entry. Submission phase only, server-enforced. */
    withdraw: () => send<{ ok: boolean }>("DELETE", "/submissions/mine"),
    submit: (body: {
      difficultyId: number;
      modRequirement: string;
      challengeRequirement: string;
    }) => send<ApiSubmission>("POST", "/submissions", body),
  },

  // ── Votes ──────────────────────────────────────────────────────────────────
  votes: {
    my: () => get<{ submissionId: number } | null>("/votes/my"),
    cast: (submissionId: number) => send<{ ok: boolean }>("POST", "/votes", { submissionId }),
    retract: () => send<{ ok: boolean }>("DELETE", "/votes"),
  },

  // ── Challenge ──────────────────────────────────────────────────────────────
  challenge: {
    /** A round's leaderboard, best first. Defaults to the open round; [] when none. */
    scores: (roundId?: number) =>
      get<ApiChallengeScore[]>(
        roundId === undefined ? "/challenge/scores" : `/challenge/scores?roundId=${roundId}`
      ),
    /** The caller's own recorded score for the open round, or null. */
    my: () => get<ApiChallengeScore | null>("/challenge/my"),
    /**
     * Imports the caller's osu! score for the winning beatmap. The body is empty:
     * the map comes from the recorded winner and the player from the session.
     */
    importMine: () =>
      send<{ ok: boolean; score: ApiChallengeScore }>("POST", "/challenge/scores"),
  },

  // ── Rankings ───────────────────────────────────────────────────────────────
  rankings: {
    /**
     * A page of the DZ Performance Rankings. Omit `year` for all-time, which is the default
     * view; omit `page` for the first page.
     */
    list: (params: { year?: number; page?: number } = {}) => {
      const query = new URLSearchParams();
      if (params.year !== undefined) query.set("year", String(params.year));
      if (params.page !== undefined) query.set("page", String(params.page));
      const suffix = query.toString();
      return get<ApiRankingPage>(suffix === "" ? "/rankings" : `/rankings?${suffix}`);
    },
    /** One player's frozen rounds, newest first. [] when they have none counted. */
    player: (userId: number, year?: number) =>
      get<ApiPlayerDzppRound[]>(
        year === undefined ? `/rankings/${userId}` : `/rankings/${userId}?year=${year}`
      ),
  },

  // ── Search ────────────────────────────────────────────────────────────────────
  search: {
    /**
     * Beatmap search over the osu! API.
     *
     * send() rather than get(), against this file's read convention and deliberately:
     * a search has four failures the page has to tell apart — signed out, rate
     * limited, osu! unavailable, and simply no matches — and get()'s `null` collapses
     * all four into the last one, which is the only one that is not an error.
     */
    beatmaps: (params: {
      q?: string;
      /** A mapper name. The server turns it into osu!'s own creator clause. */
      mapper?: string;
      status?: MapStatus | "any";
      sort?: "relevance" | "newest" | "stars" | "bpm";
      minStars?: number;
      maxStars?: number;
      minBpm?: number;
      maxBpm?: number;
    }) => {
      // Built key by key rather than handed straight to URLSearchParams: an absent bound must not
      // travel as the string "undefined", which the server would refuse as a bad number.
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === "") continue;
        query.set(key, String(value));
      }
      return send<{ results: ApiSearchHit[] }>("GET", `/search/beatmaps?${query.toString()}`);
    },
  },

  // ── Favorites ──────────────────────────────────────────────────────────────
  favorites: {
    /** The caller's favorites, both sources, newest first. [] when signed out. */
    list: () => get<ApiFavorite[]>("/favorites"),
    /**
     * Favorites a beatmap as source 'dz'. The server looks the beatmap up itself, so the
     * id is all this sends — metadata in a request body is metadata a request can invent.
     */
    add: (difficultyId: number) =>
      send<{ ok: boolean; favorite: ApiFavorite }>("PUT", `/favorites/${difficultyId}`),
    /** Removes it across BOTH sources — the heart means "not in my favorites here". */
    remove: (difficultyId: number) =>
      send<{ ok: boolean; removed: number }>("DELETE", `/favorites/${difficultyId}`),
    /**
     * Pulls the caller's osu! profile favourites in as source 'osu'. The body is empty: the
     * account comes from the session, and the server reads the list with its own token, so
     * there is nothing for a caller to assert.
     *
     * A MIRROR of that half — community favorites are untouched, and pressing it twice does
     * not double the list.
     */
    import: () =>
      send<{ ok: boolean; imported: number; favorites: ApiFavorite[] }>("POST", "/favorites/import"),
  },

  // ── Challenge chat ─────────────────────────────────────────────────────────
  //
  // Visible only during the challenge phase. Never archived.
  // Admin delete lives under api.admin.deleteChatMessage.
  chat: {
    /** All messages for the open round's challenge chat. [] when not in challenge phase. */
    list: () => get<ApiChatMessage[]>('/challenge/chat'),
    /** Post a message. requireAuth. */
    post: (body: string) =>
      send<{ ok: boolean; message: ApiChatMessage }>('POST', '/challenge/chat', { body }),
  },

  // ── Comments ───────────────────────────────────────────────────────────────
  comments: {
    /**
     * A round's whole discussion, oldest first. Defaults to the open round.
     *
     * One request for a page of a dozen cards, grouped by submission on the client — a request
     * per card would be a dozen round trips to render one page.
     */
    forRound: (roundId?: number) =>
      get<ApiComment[]>(roundId === undefined ? "/comments" : `/comments?roundId=${roundId}`),
    /** One entry's discussion, oldest first. */
    forSubmission: (submissionId: number) =>
      get<ApiComment[]>(`/comments?submissionId=${submissionId}`),
    /** Posts a comment, or a reply when parentId is given. requireAuth, not eligibility. */
    post: (submissionId: number, body: string, parentId?: number) =>
      send<{ ok: boolean; comment: ApiComment }>(
        "POST",
        "/comments",
        parentId === undefined ? { submissionId, body } : { submissionId, body, parentId }
      ),
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  settings: {
    /** The submission rules. Public: a player has to know what they must satisfy. */
    get: () => get<ApiSiteSettings>("/settings"),
  },

  // ── Admin ──────────────────────────────────────────────────────────────────
  admin: {
    /** `endsAt` overrides the scheduled end of the phase being entered. */
    setPhase: (phase: ApiRound["phase"], endsAt?: string | null) =>
      send<{ ok: boolean; round: ApiRound }>(
        "PATCH",
        "/admin/round/phase",
        endsAt === undefined ? { phase } : { phase, endsAt }
      ),
    /** Every field optional: month/year default to the current UTC month. */
    createRound: (body?: {
      month?: string;
      year?: number;
      reward?: string;
      submissionDays?: number;
      votingDays?: number;
      challengeDays?: number;
    }) => send<ApiRound>("POST", "/admin/rounds", body ?? {}),
    /** Every submission in a round, pending included. Defaults to the open round. */
    submissions: (roundId?: number) =>
      get<ApiSubmission[]>(roundId === undefined ? "/admin/submissions" : `/admin/submissions?roundId=${roundId}`),
    reviewSubmission: (id: number, status: "approved" | "rejected") =>
      send<{ ok: boolean; submission: ApiSubmission }>("PATCH", `/admin/submissions/${id}`, { status }),
    /** Ends the ballot and records a pending or tied winner. Does not advance the phase. */
    closeVoting: () =>
      send<{ ok: boolean; round: ApiRound; tied: number[] }>("POST", "/admin/round/close-voting"),
    /**
     * Ends a round whose voting phase has NOTHING approved to vote on.
     *
     * The round ends with no winner and no challenge — the honest outcome for a month
     * nobody entered. The server counts the approved entries itself and refuses with 409 if
     * there are any, so this cannot discard a real ballot; it is not an alternative to
     * closeVoting + approveWinner, which stay exactly as they were.
     */
    skipVoting: () =>
      send<{ ok: boolean; round: ApiRound }>("POST", "/admin/round/skip-voting"),
    /** Approves the winner and starts the challenge. submissionId is required on a tie. */
    approveWinner: (submissionId?: number) =>
      send<{ ok: boolean; round: ApiRound }>(
        "POST",
        "/admin/round/winner",
        submissionId === undefined ? {} : { submissionId }
      ),
    /**
     * Ends every session an account holds (G6). Separate from setting a block: a revocation
     * signs somebody out of every device, which is a different act from refusing them a vote.
     */
    revokeSessions: (userId: number) =>
      send<{ ok: boolean; sessionEpoch: number }>("POST", `/admin/users/${userId}/revoke`),
    /** Corrections applied to a round's recorded result. Defaults to the open round. */
    corrections: (roundId?: number) =>
      get<ApiResultCorrection[]>(
        roundId === undefined ? "/admin/round/corrections" : `/admin/round/corrections?roundId=${roundId}`
      ),
    /**
     * Overrides the recorded winner. The reason is required and stored — D4 exists so a
     * correction is explicit and visible rather than a silent UPDATE.
     */
    correctWinner: (submissionId: number, reason: string) =>
      send<{ ok: boolean; round: ApiRound }>("POST", "/admin/round/correction", { submissionId, reason }),
    /** One round's DZPP recompute history, newest first. roundId is required — see below. */
    dzppRecomputes: (roundId: number) =>
      get<ApiDzppRecompute[]>(`/admin/dzpp/recomputes?roundId=${roundId}`),
    /**
     * Rescores ONE ended round and records what changed.
     *
     * The round id is required and there is no bulk form on purpose: a single call that
     * rewrote every historical round would be one mistake away from reshaping the whole
     * leaderboard, and no audit row can undo that. The reason is required and stored.
     *
     * It rescores the plays AS STORED, through the same engine that froze them — so it
     * reflects a changed constant or a fixed bug, never a changed play. It also covers a round
     * that was never finalized at all, which is why there is no second endpoint for that.
     */
    recomputeDzpp: (roundId: number, reason: string) =>
      send<{ ok: boolean; summary: ApiDzppRecomputeSummary }>(
        "POST",
        "/admin/dzpp/recompute",
        { roundId, reason }
      ),
    /** Read-only server configuration — what is set, never the secrets themselves. */
    config: () => get<ApiAdminConfig>("/admin/config"),
    /** The submission rules, with who last changed them. */
    settings: () => get<ApiAdminSiteSettings>("/admin/settings"),
    /**
     * Saves part of the rules. A PATCH, so the `rules` tab saving star limits cannot rewrite
     * the `challenge` tab's lists with whatever it last rendered.
     */
    saveSettings: (patch: Partial<ApiSiteSettings>) =>
      send<{ ok: boolean; settings: ApiAdminSiteSettings }>("PUT", "/admin/settings", patch),
    /** Every account, with the effective capability flags and any override. */
    users: () => get<ApiAdminUser[]>("/admin/users"),
    /** Only the accounts that carry an override — the exception list. */
    participants: () => get<ApiParticipantException[]>("/admin/participants"),
    /**
     * Sets one account's override. Pass null for a capability to leave it to the country
     * rule; at least one of the two must be true or false, since a row overriding nothing
     * records nothing.
     */
    setParticipant: (
      userId: number,
      body: { canSubmit: boolean | null; canVote: boolean | null; note?: string | null }
    ) => send<{ ok: boolean; override: ApiParticipantOverride }>("PUT", `/admin/participants/${userId}`, body),
    /** Clears the override, so the country rule applies to that account again. */
    clearParticipant: (userId: number) =>
      send<{ ok: boolean }>("DELETE", `/admin/participants/${userId}`),
    /**
     * The country allowlist. Every row, disabled ones included — the admin tab shows
     * both, and a disabled row is a decision rather than an absence.
     */
    countries: () => get<ApiAllowedCountry[]>("/admin/countries"),
    /** Adds a country, or flips one that is already listed. */
    setCountry: (code: string, enabled: boolean) =>
      send<{ ok: boolean; country: ApiAllowedCountry }>(
        "PUT",
        `/admin/countries/${code.toUpperCase()}`,
        { enabled }
      ),
    /** Removes the row outright — for a code typed by mistake, not for disabling one. */
    removeCountry: (code: string) =>
      send<{ ok: boolean }>("DELETE", `/admin/countries/${code.toUpperCase()}`),
    /**
     * Who voted for what, for moderation. Admin-only by construction — nothing public
     * exposes voter identity.
     */
    votes: (roundId?: number) =>
      get<ApiVoteAudit[]>(roundId === undefined ? "/admin/votes" : `/admin/votes?roundId=${roundId}`),
    /** Submission ids a tied round may be resolved to. */
    tiebreakEntries: () => get<number[]>("/admin/round/tiebreak"),
    /** Deletes a challenge chat message. Admin only. */
    deleteChatMessage: (id: number) =>
      send<{ ok: boolean }>('DELETE', `/challenge/chat/${id}`),
    /**
     * Records or overrides a challenge score by hand, for a play the osu! API will
     * not give up or a correction. The player is named by osu! id.
     */
    recordScore: (body: {
      osuId: number;
      score: number;
      accuracy: number;
      misses: number;
      mods?: string;
    }) => send<{ ok: boolean; score: ApiChallengeScore }>("POST", "/admin/challenge/scores", body),
  },

  // ── Health ─────────────────────────────────────────────────────────────────
  health: () => get<{ ok: boolean }>("/health"),
};
