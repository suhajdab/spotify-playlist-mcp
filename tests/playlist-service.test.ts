import { describe, expect, it } from "vitest";
import { PlaylistService } from "../src/playlist-service.js";
import type {
  PlaylistDetails,
  PlaylistItem,
  SpotifyGateway,
} from "../src/types.js";

const PLAYLIST_ID = "0123456789ABCDEFGHIJKL";
const OTHER_PLAYLIST_ID = "ZYXWVUTSRQPONMLKJIHGFE";
const USER_ID = "spotify-user";
const A = "spotify:track:AAAAAAAAAAAAAAAAAAAAAA";
const B = "spotify:track:BBBBBBBBBBBBBBBBBBBBBB";

class FakeSpotify implements SpotifyGateway {
  details: PlaylistDetails = {
    id: PLAYLIST_ID,
    name: "Existing playlist",
    description: "Existing description",
    isPublic: true,
    ownerId: USER_ID,
    snapshotId: "snapshot-1",
    itemCount: 1,
  };

  items: PlaylistItem[] = [
    {
      uri: A,
      name: "Track A",
      artists: ["Artist A"],
      album: "Album A",
      addedAt: "2026-08-01T10:00:00Z",
    },
  ];

  removals: string[][] = [];
  additions: string[][] = [];
  detailUpdates: Array<Record<string, unknown>> = [];

  async getCurrentUserId(): Promise<string> {
    return USER_ID;
  }

  async getPlaylistDetails(): Promise<PlaylistDetails> {
    return this.details;
  }

  async getPlaylistItems(): Promise<PlaylistItem[]> {
    return this.items;
  }

  async removePlaylistItems(
    _playlistId: string,
    uris: string[]
  ): Promise<string> {
    this.removals.push(uris);
    this.details.snapshotId = "snapshot-2";
    return this.details.snapshotId;
  }

  async addPlaylistItems(
    _playlistId: string,
    uris: string[]
  ): Promise<string> {
    this.additions.push(uris);
    this.details.snapshotId = "snapshot-3";
    return this.details.snapshotId;
  }

  async updatePlaylistDetails(
    _playlistId: string,
    details: Record<string, unknown>
  ): Promise<void> {
    this.detailUpdates.push(details);
  }
}

function createService(spotify = new FakeSpotify()) {
  let now = Date.parse("2026-08-20T12:00:00Z");
  return {
    spotify,
    service: new PlaylistService(spotify, {
      allowedPlaylistIds: new Set([PLAYLIST_ID]),
      maxChangesPerPlan: 5,
      planTtlMs: 10 * 60 * 1000,
      now: () => now,
      createPlanId: () => "plan-1",
    }),
    advanceTime: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("PlaylistService", () => {
  it("refuses to plan changes for a playlist outside the allowlist", async () => {
    const { service } = createService();

    await expect(
      service.planChanges({
        playlistId: OTHER_PLAYLIST_ID,
        addTrackUris: [B],
      })
    ).rejects.toThrow("not allowlisted");
  });

  it("refuses to plan changes when the authenticated user is not the owner", async () => {
    const spotify = new FakeSpotify();
    spotify.details.ownerId = "someone-else";
    const { service } = createService(spotify);

    await expect(
      service.planChanges({ playlistId: PLAYLIST_ID, addTrackUris: [B] })
    ).rejects.toThrow("not owned by the authenticated Spotify user");
  });

  it("applies only the exact short-lived plan against the expected snapshot", async () => {
    const { service, spotify } = createService();
    const plan = await service.planChanges({
      playlistId: PLAYLIST_ID,
      addTrackUris: [B],
      removeTrackUris: [A],
      details: { description: "Curated by Future Martian Music" },
    });

    const result = await service.applyPlan(plan.planId);

    expect(spotify.removals).toEqual([[A]]);
    expect(spotify.additions).toEqual([[B]]);
    expect(spotify.detailUpdates).toEqual([
      { description: "Curated by Future Martian Music" },
    ]);
    expect(result.finalSnapshotId).toBe("snapshot-3");
    await expect(service.applyPlan(plan.planId)).rejects.toThrow(
      "unknown, expired, or already applied"
    );
  });

  it("refuses an expired plan or a playlist changed since planning", async () => {
    const expired = createService();
    const expiredPlan = await expired.service.planChanges({
      playlistId: PLAYLIST_ID,
      addTrackUris: [B],
    });
    expired.advanceTime(11 * 60 * 1000);
    await expect(expired.service.applyPlan(expiredPlan.planId)).rejects.toThrow(
      "expired"
    );

    const changed = createService();
    const changedPlan = await changed.service.planChanges({
      playlistId: PLAYLIST_ID,
      addTrackUris: [B],
    });
    changed.spotify.details.snapshotId = "someone-edited-it";
    await expect(changed.service.applyPlan(changedPlan.planId)).rejects.toThrow(
      "changed since this plan was created"
    );
  });
});
