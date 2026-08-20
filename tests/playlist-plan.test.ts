import { describe, expect, it } from "vitest";
import {
  buildPlaylistChangeSet,
  normalizeSpotifyTrackUri,
} from "../src/playlist-plan.js";

const A = "spotify:track:AAAAAAAAAAAAAAAAAAAAAA";
const B = "spotify:track:BBBBBBBBBBBBBBBBBBBBBB";
const C = "spotify:track:CCCCCCCCCCCCCCCCCCCCCC";
const D = "spotify:track:DDDDDDDDDDDDDDDDDDDDDD";

describe("normalizeSpotifyTrackUri", () => {
  it("accepts canonical Spotify track URIs", () => {
    expect(normalizeSpotifyTrackUri(A)).toBe(A);
  });

  it("normalizes open.spotify.com track URLs", () => {
    expect(
      normalizeSpotifyTrackUri(
        "https://open.spotify.com/track/AAAAAAAAAAAAAAAAAAAAAA?si=abc"
      )
    ).toBe(A);
  });

  it("rejects non-track and malformed Spotify identifiers", () => {
    expect(() =>
      normalizeSpotifyTrackUri("spotify:album:AAAAAAAAAAAAAAAAAAAAAA")
    ).toThrow("Spotify track URI or URL");
    expect(() => normalizeSpotifyTrackUri("spotify:track:short")).toThrow(
      "Spotify track URI or URL"
    );
  });
});
describe("buildPlaylistChangeSet", () => {
  it("calculates additions, removals, projected order, and detail changes", () => {
    const result = buildPlaylistChangeSet(
      [A, B, C],
      {
        addTrackUris: [D],
        removeTrackUris: [B],
        details: { name: "Tomorrow Is Worth Reaching", public: true },
      },
      5
    );

    expect(result.addTrackUris).toEqual([D]);
    expect(result.removeTrackUris).toEqual([B]);
    expect(result.projectedTrackUris).toEqual([A, C, D]);
    expect(result.impact).toEqual({
      additions: 1,
      removalOccurrences: 1,
      detailFields: 2,
      totalTrackChanges: 2,
    });
  });

  it("skips additions already present and removals that are absent", () => {
    const result = buildPlaylistChangeSet(
      [A, B],
      { addTrackUris: [A], removeTrackUris: [C] },
      5
    );

    expect(result.addTrackUris).toEqual([]);
    expect(result.removeTrackUris).toEqual([]);
    expect(result.warnings).toEqual([
      `${A} is already in the playlist; addition skipped`,
      `${C} is not in the playlist; removal skipped`,
    ]);
  });

  it("counts every duplicate occurrence affected by a URI removal", () => {
    const result = buildPlaylistChangeSet(
      [A, B, A],
      { removeTrackUris: [A] },
      2
    );

    expect(result.projectedTrackUris).toEqual([B]);
    expect(result.impact.removalOccurrences).toBe(2);
  });

  it("rejects ambiguous and oversized mutation requests", () => {
    expect(() =>
      buildPlaylistChangeSet(
        [A],
        { addTrackUris: [B], removeTrackUris: [B] },
        5
      )
    ).toThrow("both added and removed");

    expect(() =>
      buildPlaylistChangeSet(
        [A, B, C],
        { removeTrackUris: [A, B, C] },
        2
      )
    ).toThrow("maximum of 2 track changes");
  });
});
