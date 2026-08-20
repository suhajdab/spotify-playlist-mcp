import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createSpotifyMcpServer } from "../src/server.js";
import { PlaylistService } from "../src/playlist-service.js";
import type {
  OwnedPlaylistSummary,
  PlaylistDetailUpdate,
  PlaylistDetails,
  PlaylistItem,
  SpotifyGateway,
  TrackSearchResult,
} from "../src/types.js";
import type { TokenRecord, TokenStore } from "../src/token-store.js";

const PLAYLIST_ID = "0123456789ABCDEFGHIJKL";
const TRACK_URI = "spotify:track:AAAAAAAAAAAAAAAAAAAAAA";

class FakeTokenStore implements TokenStore {
  async read(): Promise<TokenRecord | null> {
    return null;
  }
  async write(): Promise<void> {}
}

class FakeSpotify implements SpotifyGateway {
  async getCurrentUserId(): Promise<string> {
    return "spotify-user";
  }
  async getPlaylistDetails(): Promise<PlaylistDetails> {
    return {
      id: PLAYLIST_ID,
      name: "Public playlist",
      description: "Description",
      isPublic: true,
      ownerId: "spotify-user",
      snapshotId: "snapshot-1",
      itemCount: 0,
    };
  }
  async getPlaylistItems(): Promise<PlaylistItem[]> {
    return [];
  }
  async listOwnedPlaylists(): Promise<OwnedPlaylistSummary[]> {
    return [
      {
        id: PLAYLIST_ID,
        name: "Public playlist",
        description: "Description",
        isPublic: true,
        snapshotId: "snapshot-1",
        itemCount: 0,
        spotifyUrl: "https://open.spotify.com/playlist/test",
      },
    ];
  }
  async searchTracks(): Promise<TrackSearchResult[]> {
    return [];
  }
  async removePlaylistItems(): Promise<string> {
    return "snapshot-2";
  }
  async addPlaylistItems(): Promise<string> {
    return "snapshot-2";
  }
  async updatePlaylistDetails(
    _playlistId: string,
    _details: PlaylistDetailUpdate
  ): Promise<void> {}
}

describe("Spotify playlist MCP server", () => {
  it("advertises read tools separately from guarded write tools", async () => {
    const spotify = new FakeSpotify();
    const service = new PlaylistService(spotify, {
      allowedPlaylistIds: new Set([PLAYLIST_ID]),
      maxChangesPerPlan: 5,
      createPlanId: () => "plan-1",
    });
    const server = createSpotifyMcpServer({
      spotify,
      playlistService: service,
      tokenStore: new FakeTokenStore(),
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "spotify_auth_status",
        "spotify_list_owned_playlists",
        "spotify_search_tracks",
        "spotify_get_playlist",
        "spotify_plan_playlist_changes",
        "spotify_apply_playlist_plan",
      ]);
      expect(
        tools.tools.find((tool) => tool.name === "spotify_plan_playlist_changes")
          ?.annotations
      ).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(
        tools.tools.find((tool) => tool.name === "spotify_apply_playlist_plan")
          ?.annotations
      ).toMatchObject({ readOnlyHint: false, destructiveHint: true });

      const planResult = await client.callTool({
        name: "spotify_plan_playlist_changes",
        arguments: { playlist_id: PLAYLIST_ID, add_track_uris: [TRACK_URI] },
      });
      expect(planResult.isError).not.toBe(true);
      if (!Array.isArray(planResult.content)) {
        throw new Error("Expected MCP tool content array");
      }
      const text = planResult.content[0] as
        | { type: "text"; text: string }
        | undefined;
      expect(text?.type).toBe("text");
      if (text?.type === "text") {
        expect(JSON.parse(text.text)).toMatchObject({
          planId: "plan-1",
          playlist: { id: PLAYLIST_ID },
          changes: { addTrackUris: [TRACK_URI] },
        });
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
