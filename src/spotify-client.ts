import { z } from "zod";
import type { TokenRecord, TokenStore } from "./token-store.js";
import type {
  PlaylistDetailUpdate,
  PlaylistDetails,
  PlaylistItem,
  OwnedPlaylistSummary,
  SpotifyGateway,
  TrackSearchResult,
} from "./types.js";

const API_BASE_URL = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

const UserSchema = z.object({ id: z.string().min(1) }).passthrough();

const PlaylistDetailsSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    public: z.boolean().nullable(),
    owner: z.object({ id: z.string() }),
    snapshot_id: z.string(),
    items: z.object({ total: z.number().int().nonnegative() }).optional(),
    tracks: z.object({ total: z.number().int().nonnegative() }).optional(),
  })
  .passthrough();

const PlaylistItemPageSchema = z.object({
  items: z.array(
    z.object({
      added_at: z.string().nullable().optional(),
      item: z
        .object({
          uri: z.string(),
          name: z.string(),
          type: z.string(),
          artists: z.array(z.object({ name: z.string() })),
          album: z.object({ name: z.string() }),
        })
        .passthrough()
        .nullable(),
    })
  ),
  next: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

const SnapshotSchema = z.object({ snapshot_id: z.string().min(1) });

const PlaylistSummaryPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable().optional(),
      public: z.boolean().nullable(),
      owner: z.object({ id: z.string() }),
      snapshot_id: z.string(),
      items: z.object({ total: z.number().int().nonnegative() }).optional(),
      tracks: z.object({ total: z.number().int().nonnegative() }).optional(),
      external_urls: z.object({ spotify: z.string().url() }),
    })
  ),
  next: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

const TrackSearchResponseSchema = z.object({
  tracks: z.object({
    items: z.array(
      z.object({
        uri: z.string(),
        name: z.string(),
        artists: z.array(z.object({ name: z.string() })),
        album: z.object({ name: z.string() }),
        external_urls: z.object({ spotify: z.string().url() }),
      })
    ),
  }),
});

export class SpotifyAuthExpiredError extends Error {
  constructor(message = "Spotify authorization expired; run the auth bootstrap again") {
    super(message);
    this.name = "SpotifyAuthExpiredError";
  }
}

interface SpotifyClientOptions {
  clientId: string;
  clientSecret: string;
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class SpotifyClient implements SpotifyGateway {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(private readonly options: SpotifyClientOptions) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async getCurrentUserId(): Promise<string> {
    return UserSchema.parse(await this.#apiRequest("GET", "/me")).id;
  }

  async getPlaylistDetails(playlistId: string): Promise<PlaylistDetails> {
    this.#assertPlaylistId(playlistId);
    const data = PlaylistDetailsSchema.parse(
      await this.#apiRequest(
        "GET",
        `/playlists/${playlistId}?fields=id,name,description,public,owner.id,snapshot_id,items.total,tracks.total`
      )
    );
    return {
      id: data.id,
      name: data.name,
      description: data.description ?? "",
      isPublic: data.public,
      ownerId: data.owner.id,
      snapshotId: data.snapshot_id,
      itemCount: data.items?.total ?? data.tracks?.total ?? 0,
    };
  }

  async getPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
    this.#assertPlaylistId(playlistId);
    const result: PlaylistItem[] = [];
    let offset = 0;
    while (true) {
      const page = PlaylistItemPageSchema.parse(
        await this.#apiRequest(
          "GET",
          `/playlists/${playlistId}/items?limit=50&offset=${offset}`
        )
      );
      for (const entry of page.items) {
        if (!entry.item || entry.item.type !== "track") continue;
        if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(entry.item.uri)) continue;
        result.push({
          uri: entry.item.uri,
          name: entry.item.name,
          artists: entry.item.artists.map((artist) => artist.name),
          album: entry.item.album.name,
          addedAt: entry.added_at ?? null,
        });
      }
      if (!page.next || page.items.length === 0) break;
      offset += page.items.length;
    }
    return result;
  }

  async listOwnedPlaylists(): Promise<OwnedPlaylistSummary[]> {
    const userId = await this.getCurrentUserId();
    const result: OwnedPlaylistSummary[] = [];
    let offset = 0;
    while (true) {
      const page = PlaylistSummaryPageSchema.parse(
        await this.#apiRequest("GET", `/me/playlists?limit=50&offset=${offset}`)
      );
      for (const playlist of page.items) {
        if (playlist.owner.id !== userId) continue;
        result.push({
          id: playlist.id,
          name: playlist.name,
          description: playlist.description ?? "",
          isPublic: playlist.public,
          snapshotId: playlist.snapshot_id,
          itemCount: playlist.items?.total ?? playlist.tracks?.total ?? 0,
          spotifyUrl: playlist.external_urls.spotify,
        });
      }
      if (!page.next || page.items.length === 0) break;
      offset += page.items.length;
    }
    return result;
  }

  async searchTracks(query: string, limit = 10): Promise<TrackSearchResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) throw new Error("Spotify search query is required");
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new Error("Spotify search limit must be between 1 and 10");
    }
    const parameters = new URLSearchParams({
      q: trimmedQuery,
      type: "track",
      limit: String(limit),
    });
    const data = TrackSearchResponseSchema.parse(
      await this.#apiRequest("GET", `/search?${parameters.toString()}`)
    );
    return data.tracks.items
      .filter((track) => /^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri))
      .map((track) => ({
        uri: track.uri,
        name: track.name,
        artists: track.artists.map((artist) => artist.name),
        album: track.album.name,
        spotifyUrl: track.external_urls.spotify,
      }));
  }

  async removePlaylistItems(
    playlistId: string,
    uris: string[],
    snapshotId: string
  ): Promise<string> {
    this.#assertPlaylistId(playlistId);
    const result = SnapshotSchema.parse(
      await this.#apiRequest("DELETE", `/playlists/${playlistId}/items`, {
        items: uris.map((uri) => ({ uri })),
        snapshot_id: snapshotId,
      })
    );
    return result.snapshot_id;
  }

  async addPlaylistItems(playlistId: string, uris: string[]): Promise<string> {
    this.#assertPlaylistId(playlistId);
    const result = SnapshotSchema.parse(
      await this.#apiRequest("POST", `/playlists/${playlistId}/items`, { uris })
    );
    return result.snapshot_id;
  }

  async updatePlaylistDetails(
    playlistId: string,
    details: PlaylistDetailUpdate
  ): Promise<void> {
    this.#assertPlaylistId(playlistId);
    await this.#apiRequest("PUT", `/playlists/${playlistId}`, details, true);
  }

  async #apiRequest(
    method: string,
    path: string,
    body?: unknown,
    expectsEmptyResponse = false,
    retryOnUnauthorized = true
  ): Promise<unknown> {
    const accessToken = await this.#getAccessToken();
    const response = await this.#fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 401 && retryOnUnauthorized) {
      await this.#refreshAccessToken();
      return this.#apiRequest(method, path, body, expectsEmptyResponse, false);
    }
    if (!response.ok) {
      if (response.status === 401) throw new SpotifyAuthExpiredError();
      const retryAfter = response.headers.get("retry-after");
      throw new Error(
        `Spotify API request failed with status ${response.status}${
          retryAfter ? `; retry after ${retryAfter} seconds` : ""
        }`
      );
    }
    if (expectsEmptyResponse || response.status === 204) return undefined;
    return response.json();
  }

  async #getAccessToken(): Promise<string> {
    const token = await this.options.tokenStore.read();
    if (!token) {
      throw new SpotifyAuthExpiredError(
        "Spotify authorization is not initialized; run the auth bootstrap"
      );
    }
    if (
      token.accessToken &&
      token.accessTokenExpiresAt &&
      this.#now() < token.accessTokenExpiresAt
    ) {
      return token.accessToken;
    }
    return this.#refreshAccessToken(token);
  }

  async #refreshAccessToken(existing?: TokenRecord): Promise<string> {
    const token = existing ?? (await this.options.tokenStore.read());
    if (!token) {
      throw new SpotifyAuthExpiredError(
        "Spotify authorization is not initialized; run the auth bootstrap"
      );
    }
    const response = await this.#fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${this.options.clientId}:${this.options.clientSecret}`
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      if ([400, 401].includes(response.status)) throw new SpotifyAuthExpiredError();
      throw new Error(`Spotify token refresh failed with status ${response.status}`);
    }

    const refreshed = TokenResponseSchema.parse(await response.json());
    const next: TokenRecord = {
      ...token,
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      accessToken: refreshed.access_token,
      accessTokenExpiresAt:
        this.#now() + Math.max(0, refreshed.expires_in - 60) * 1000,
      scope: refreshed.scope ?? token.scope,
    };
    await this.options.tokenStore.write(next);
    return next.accessToken!;
  }

  #assertPlaylistId(playlistId: string): void {
    if (!PLAYLIST_ID_PATTERN.test(playlistId)) {
      throw new Error(`Invalid Spotify playlist ID: ${playlistId}`);
    }
  }
}
