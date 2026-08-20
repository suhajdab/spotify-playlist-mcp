import { describe, expect, it } from "vitest";
import { SpotifyClient } from "../src/spotify-client.js";
import type { TokenRecord, TokenStore } from "../src/token-store.js";

class MemoryTokenStore implements TokenStore {
  constructor(public token: TokenRecord | null) {}
  async read(): Promise<TokenRecord | null> {
    return this.token;
  }
  async write(token: TokenRecord): Promise<void> {
    this.token = token;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SpotifyClient", () => {
  it("refreshes an expired access token and never exposes credentials in requests", async () => {
    const store = new MemoryTokenStore({
      refreshToken: "refresh-secret",
      accessToken: "expired-access",
      accessTokenExpiresAt: 1,
      authorizedAt: 1,
      scope: "playlist-modify-public",
    });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === "https://accounts.spotify.com/api/token") {
        return jsonResponse({
          access_token: "fresh-access",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "playlist-modify-public",
        });
      }
      return jsonResponse({ id: "spotify-user" });
    };
    const client = new SpotifyClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenStore: store,
      fetchImpl,
      now: () => 10_000,
    });

    expect(await client.getCurrentUserId()).toBe("spotify-user");
    expect(store.token?.accessToken).toBe("fresh-access");
    expect(requests[1]?.init?.headers).toMatchObject({
      Authorization: "Bearer fresh-access",
    });
    expect(JSON.stringify(requests[1])).not.toContain("client-secret");
    expect(JSON.stringify(requests[1])).not.toContain("refresh-secret");
  });

  it("parses playlist items from the current items endpoint shape", async () => {
    const store = new MemoryTokenStore({
      refreshToken: "refresh-secret",
      accessToken: "valid-access",
      accessTokenExpiresAt: 100_000,
      authorizedAt: 1,
      scope: "playlist-read-private",
    });
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        items: [
          {
            added_at: "2026-08-20T10:00:00Z",
            item: {
              uri: "spotify:track:AAAAAAAAAAAAAAAAAAAAAA",
              name: "Track A",
              type: "track",
              artists: [{ name: "Artist A" }],
              album: { name: "Album A" },
            },
          },
          { added_at: null, item: null },
        ],
        next: null,
        total: 2,
      });
    const client = new SpotifyClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenStore: store,
      fetchImpl,
      now: () => 10_000,
    });

    expect(
      await client.getPlaylistItems("0123456789ABCDEFGHIJKL")
    ).toEqual([
      {
        uri: "spotify:track:AAAAAAAAAAAAAAAAAAAAAA",
        name: "Track A",
        artists: ["Artist A"],
        album: "Album A",
        addedAt: "2026-08-20T10:00:00Z",
      },
    ]);
  });

  it("rejects use before the one-time authorization bootstrap", async () => {
    const client = new SpotifyClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenStore: new MemoryTokenStore(null),
      fetchImpl: async () => jsonResponse({}),
    });

    await expect(client.getCurrentUserId()).rejects.toThrow(
      "Spotify authorization is not initialized"
    );
  });

  it("lists only owned playlists and returns compact track search results", async () => {
    const store = new MemoryTokenStore({
      refreshToken: "refresh-secret",
      accessToken: "valid-access",
      accessTokenExpiresAt: 100_000,
      authorizedAt: 1,
      scope: "playlist-read-private",
    });
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/me/playlists")) {
        return jsonResponse({
          items: [
            {
              id: "0123456789ABCDEFGHIJKL",
              name: "Owned",
              description: "Description",
              public: true,
              owner: { id: "spotify-user" },
              snapshot_id: "snapshot-1",
              items: { total: 3 },
              external_urls: { spotify: "https://open.spotify.com/playlist/owned" },
            },
            {
              id: "ZYXWVUTSRQPONMLKJIHGFE",
              name: "Followed",
              description: "",
              public: true,
              owner: { id: "someone-else" },
              snapshot_id: "snapshot-2",
              items: { total: 9 },
              external_urls: { spotify: "https://open.spotify.com/playlist/followed" },
            },
          ],
          next: null,
          total: 2,
        });
      }
      if (url.includes("/search?")) {
        return jsonResponse({
          tracks: {
            items: [
              {
                uri: "spotify:track:AAAAAAAAAAAAAAAAAAAAAA",
                name: "Track A",
                artists: [{ name: "Artist A" }],
                album: { name: "Album A" },
                external_urls: { spotify: "https://open.spotify.com/track/a" },
              },
            ],
          },
        });
      }
      return jsonResponse({ id: "spotify-user" });
    };
    const client = new SpotifyClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenStore: store,
      fetchImpl,
      now: () => 10_000,
    });

    expect(await client.listOwnedPlaylists()).toEqual([
      {
        id: "0123456789ABCDEFGHIJKL",
        name: "Owned",
        description: "Description",
        isPublic: true,
        snapshotId: "snapshot-1",
        itemCount: 3,
        spotifyUrl: "https://open.spotify.com/playlist/owned",
      },
    ]);
    expect(await client.searchTracks("future trance", 5)).toEqual([
      {
        uri: "spotify:track:AAAAAAAAAAAAAAAAAAAAAA",
        name: "Track A",
        artists: ["Artist A"],
        album: "Album A",
        spotifyUrl: "https://open.spotify.com/track/a",
      },
    ]);
  });
});
