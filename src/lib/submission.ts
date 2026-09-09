// ApiSubmission -> Beatmap.
//
// The two shapes were deliberately named alike, but they are not identical: the
// DTO's id is a number and Beatmap's is a string, its map status lives under
// `mapStatus` while Beatmap calls it `status`, and Beatmap has no place for
// beatmapsetId or the review state. So the seam needs this small mapper rather
// than a cast.

import { ApiBeatmapPreview, ApiFavorite, ApiSearchHit, ApiSubmission } from '../api/client';
import { Beatmap } from '../types';

export function toBeatmap(submission: ApiSubmission): Beatmap {
  return {
    id: String(submission.id),
    difficultyId: submission.difficultyId,
    title: submission.title,
    artist: submission.artist,
    mapper: submission.mapper,
    difficultyName: submission.difficultyName,
    stars: submission.stars,
    bpm: submission.bpm,
    length: submission.length,
    status: submission.mapStatus,
    coverUrl: submission.coverUrl,
    previewUrl: submission.previewUrl || undefined,
    cs: submission.cs,
    ar: submission.ar,
    od: submission.od,
    hp: submission.hp,
    voteCount: submission.voteCount,
    // isVoted is not on the DTO: whose vote it would be depends on the caller, so
    // App sets it from GET /api/votes/my instead.
    isFavorited: submission.isFavorited ?? false,
    modRequirement: submission.modRequirement,
    challengeType: submission.challengeRequirement,
    submittedByName: submission.submittedByName,
  };
}

/**
 * osu! difficulty URL, for "open on osu!" links.
 *
 * Takes the two ids rather than a whole ApiSubmission so a search hit can use it too —
 * both DTOs carry the same pair, and the alternative was a second copy of the URL
 * format on the search page.
 */
export const beatmapUrl = (map: { beatmapsetId: number; difficultyId: number }): string =>
  `https://osu.ppy.sh/beatmapsets/${map.beatmapsetId}#osu/${map.difficultyId}`;

/**
 * How a review state is presented. Lives here rather than in a page because the
 * dashboard and the submit page both show it, and two copies would drift.
 *
 * 'rejected' reads as "Changes Requested" by request, and its blurb now points at
 * the submit form rather than at an administrator: DELETE /api/submissions/mine
 * means a submitter can withdraw and re-enter on their own, as long as the round is
 * still in its submission phase.
 */
export const REVIEW_PRESENTATION: Record<
  ApiSubmission['reviewStatus'],
  { label: string; tone: string; blurb: string }
> = {
  pending: {
    label: 'Pending Review',
    tone: 'bg-amber-400/10 border-amber-400/25 text-amber-400',
    blurb: 'An administrator still has to approve this before it enters the community vote.',
  },
  approved: {
    label: 'Approved',
    tone: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
    blurb: 'This beatmap is in the community vote for this round. Good luck!',
  },
  rejected: {
    label: 'Changes Requested',
    tone: 'bg-rose-500/10 border-rose-500/25 text-rose-400',
    blurb: 'An administrator asked for changes. Withdraw this entry and submit again while submissions are open.',
  },
};

/** "2:19" from the preview's raw seconds — submissions arrive pre-formatted. */
export const formatLength = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The lookup result, shaped for the same card the rest of the app renders. */
export function previewToBeatmap(preview: ApiBeatmapPreview): Beatmap {
  return {
    id: `preview-${preview.difficultyId}`,
    difficultyId: preview.difficultyId,
    title: preview.title,
    artist: preview.artist,
    mapper: preview.mapper,
    difficultyName: preview.difficultyName,
    stars: preview.stars,
    bpm: preview.bpm,
    length: formatLength(preview.lengthSeconds),
    status: preview.mapStatus,
    coverUrl: preview.coverUrl,
    previewUrl: preview.previewUrl || undefined,
    cs: preview.cs ?? undefined,
    ar: preview.ar ?? undefined,
    od: preview.od ?? undefined,
    hp: preview.hp ?? undefined,
  };
}

/**
 * A search hit, shaped for the same card the rest of the app renders.
 *
 * The id is prefixed the way previewToBeatmap prefixes its own: these are not
 * submissions, and a bare difficulty id sharing a key space with submission ids is the
 * kind of collision that only shows up once both are on screen at once.
 */
export function searchHitToBeatmap(hit: ApiSearchHit): Beatmap {
  return {
    id: `search-${hit.difficultyId}`,
    difficultyId: hit.difficultyId,
    title: hit.title,
    artist: hit.artist,
    mapper: hit.mapper,
    difficultyName: hit.difficultyName,
    stars: hit.stars,
    bpm: hit.bpm,
    length: formatLength(hit.lengthSeconds),
    status: hit.mapStatus,
    coverUrl: hit.coverUrl,
    previewUrl: hit.previewUrl || undefined,
  };
}

/**
 * A favorite, shaped for the same card the rest of the app renders.
 *
 * mapStatus is a free string on ApiFavorite, because a favorite may be graveyard or
 * pending, while Beatmap.status is the three-value union the card's badge is keyed on.
 * Anything outside that union renders as 'approved' — the neutral badge — rather than
 * crashing the card on a missing statusConfig entry.
 */
export function favoriteToBeatmap(favorite: ApiFavorite): Beatmap {
  const status: Beatmap['status'] =
    favorite.mapStatus === 'ranked' || favorite.mapStatus === 'loved' ? favorite.mapStatus : 'approved';

  return {
    id: `fav-${favorite.source}-${favorite.difficultyId}`,
    difficultyId: favorite.difficultyId,
    title: favorite.title,
    artist: favorite.artist,
    mapper: favorite.mapper,
    difficultyName: favorite.difficultyName,
    stars: favorite.stars,
    bpm: favorite.bpm,
    length: formatLength(favorite.lengthSeconds),
    status,
    coverUrl: favorite.coverUrl,
    previewUrl: favorite.previewUrl || undefined,
    isFavorited: true,
  };
}
