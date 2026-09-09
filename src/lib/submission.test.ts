import { describe, expect, it } from 'vitest';
import {
  REVIEW_PRESENTATION,
  beatmapUrl,
  favoriteToBeatmap,
  searchHitToBeatmap,
  toBeatmap,
} from './submission';
import type { ApiFavorite, ApiSearchHit, ApiSubmission } from '../api/client';

const submission = (over: Partial<ApiSubmission> = {}): ApiSubmission => ({
  id: 7,
  beatmapsetId: 2297621,
  difficultyId: 4907876,
  title: 'Souzou Forest',
  artist: 'Kano',
  mapper: 'Kana Arima',
  difficultyName: 'Expert',
  mapStatus: 'ranked',
  coverUrl: 'https://assets.ppy.sh/cover.jpg',
  previewUrl: 'https://b.ppy.sh/preview/2297621.mp3',
  stars: 5.67,
  bpm: 180,
  length: '4:06',
  cs: 3.8,
  ar: 9.2,
  od: 9,
  hp: 5,
  challengeRequirement: 'Lowest Miss Count',
  modRequirement: 'HD',
  submittedByName: 'Heaki',
  voteCount: 3,
  reviewStatus: 'approved',
  submittedAt: '2026-09-03T23:52:19.497Z',
  ...over,
});

describe('toBeatmap', () => {
  it('renames the three fields the two shapes disagree about', () => {
    const mapped = toBeatmap(submission());
    // id is a string on Beatmap and a number on the DTO — the reason this mapper exists
    // rather than a cast.
    expect(mapped.id).toBe('7');
    expect(mapped.status).toBe('ranked');
    expect(mapped.challengeType).toBe('Lowest Miss Count');
  });

  it('carries the vote count and the requirements through untouched', () => {
    const mapped = toBeatmap(submission({ voteCount: 12 }));
    expect(mapped.voteCount).toBe(12);
    expect(mapped.modRequirement).toBe('HD');
    expect(mapped.submittedByName).toBe('Heaki');
  });

  // isVoted is per-caller: whose vote it would be depends on who is asking, so App
  // applies it from GET /votes/my instead of this mapper inventing an answer.
  it('does not decide whether the caller voted for it', () => {
    expect(toBeatmap(submission()).isVoted).toBeUndefined();
  });

  it('turns an empty preview url into undefined, so no audio element is built', () => {
    expect(toBeatmap(submission({ previewUrl: '' })).previewUrl).toBeUndefined();
  });

  it('defaults isFavorited rather than leaving it undefined', () => {
    expect(toBeatmap(submission()).isFavorited).toBe(false);
    expect(toBeatmap(submission({ isFavorited: true })).isFavorited).toBe(true);
  });
});

describe('beatmapUrl', () => {
  it('links the difficulty, not just the set', () => {
    expect(beatmapUrl(submission())).toBe(
      'https://osu.ppy.sh/beatmapsets/2297621#osu/4907876'
    );
  });
});

describe('REVIEW_PRESENTATION', () => {
  it('has a label, a tone and a blurb for every review state', () => {
    for (const status of ['pending', 'approved', 'rejected'] as const) {
      const copy = REVIEW_PRESENTATION[status];
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.tone.length).toBeGreaterThan(0);
      expect(copy.blurb.length).toBeGreaterThan(0);
    }
  });

  // Named by request: the state is 'rejected' in the database but a submitter is told
  // changes were requested, because they can withdraw and re-enter while the round is
  // still in its submission phase.
  it('presents rejection as changes requested', () => {
    expect(REVIEW_PRESENTATION.rejected.label).toBe('Changes Requested');
  });
});

describe('searchHitToBeatmap', () => {
  const hit = (over: Partial<ApiSearchHit> = {}): ApiSearchHit => ({
    difficultyId: 4907876,
    beatmapsetId: 2297621,
    title: 'Souzou Forest',
    artist: 'Kano',
    mapper: 'Kana Arima',
    difficultyName: 'Expert',
    mapStatus: 'ranked',
    coverUrl: 'https://assets.ppy.sh/cover.jpg',
    previewUrl: 'https://b.ppy.sh/preview/2297621.mp3',
    stars: 5.67,
    bpm: 180,
    lengthSeconds: 246,
    difficultyCount: 7,
    ...over,
  });

  // A search hit is not a submission, and a bare difficulty id sharing a key space with
  // submission ids is a collision that only shows up once both are on screen.
  it('prefixes the id so it cannot collide with a submission id', () => {
    expect(searchHitToBeatmap(hit()).id).toBe('search-4907876');
  });

  it('formats the raw seconds the way the card expects', () => {
    expect(searchHitToBeatmap(hit()).length).toBe('4:06');
    expect(searchHitToBeatmap(hit({ lengthSeconds: 63 })).length).toBe('1:03');
  });

  it('carries the map status through as the card status', () => {
    expect(searchHitToBeatmap(hit({ mapStatus: 'loved' })).status).toBe('loved');
  });

  it('turns an empty preview url into undefined, so no audio element is built', () => {
    expect(searchHitToBeatmap(hit({ previewUrl: '' })).previewUrl).toBeUndefined();
  });

  // A search hit carries no round context, and inventing a zero would render a vote bar
  // on a page that has nothing to vote on.
  it('leaves the round fields unset', () => {
    const beatmap = searchHitToBeatmap(hit());
    expect(beatmap.voteCount).toBeUndefined();
    expect(beatmap.modRequirement).toBeUndefined();
    expect(beatmap.submittedByName).toBeUndefined();
  });
});

describe('beatmapUrl, for a search hit', () => {
  it('takes the two ids from any shape that carries them', () => {
    expect(beatmapUrl({ beatmapsetId: 41823, difficultyId: 131891 })).toBe(
      'https://osu.ppy.sh/beatmapsets/41823#osu/131891'
    );
  });
});

describe('favoriteToBeatmap', () => {
  const favorite = (over: Partial<ApiFavorite> = {}): ApiFavorite => ({
    difficultyId: 4907876,
    beatmapsetId: 2297621,
    source: 'dz',
    title: 'Souzou Forest',
    artist: 'Kano',
    mapper: 'Kana Arima',
    difficultyName: 'Expert',
    mapStatus: 'ranked',
    coverUrl: 'https://assets.ppy.sh/cover.jpg',
    previewUrl: 'https://b.ppy.sh/preview/2297621.mp3',
    stars: 5.67,
    bpm: 180,
    lengthSeconds: 246,
    favoritedAt: '2026-09-05T10:00:00.000Z',
    ...over,
  });

  // The same beatmap can legitimately be favorited from both sources, and the primary key
  // allows exactly that — so the source has to be part of the React key or the two rows
  // collide the moment an import lands on top of a community favorite.
  it('keys on the source as well as the difficulty', () => {
    expect(favoriteToBeatmap(favorite()).id).toBe('fav-dz-4907876');
    expect(favoriteToBeatmap(favorite({ source: 'osu' })).id).toBe('fav-osu-4907876');
  });

  it('carries the difficulty id, which is what favoriting addresses', () => {
    expect(favoriteToBeatmap(favorite()).difficultyId).toBe(4907876);
  });

  // A favorite may be graveyard or pending — the ranked-status rule is the submit path's.
  // Beatmap.status is a three-value union the card's badge is keyed on, so anything outside
  // it renders as the neutral badge rather than crashing on a missing statusConfig entry.
  it('folds an unsubmittable status onto the neutral badge', () => {
    expect(favoriteToBeatmap(favorite({ mapStatus: 'ranked' })).status).toBe('ranked');
    expect(favoriteToBeatmap(favorite({ mapStatus: 'loved' })).status).toBe('loved');
    expect(favoriteToBeatmap(favorite({ mapStatus: 'graveyard' })).status).toBe('approved');
    expect(favoriteToBeatmap(favorite({ mapStatus: 'pending' })).status).toBe('approved');
    expect(favoriteToBeatmap(favorite({ mapStatus: '' })).status).toBe('approved');
  });

  it('is favorited by construction — it came out of the favorites table', () => {
    expect(favoriteToBeatmap(favorite()).isFavorited).toBe(true);
  });

  it('formats the raw seconds for the card', () => {
    expect(favoriteToBeatmap(favorite()).length).toBe('4:06');
  });
});
