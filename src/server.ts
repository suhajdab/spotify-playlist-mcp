import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAuthorizationStatus } from "./spotify-auth.js";
import type { PlaylistService } from "./playlist-service.js";
import type { TokenStore } from "./token-store.js";
import type {
  OwnedPlaylistSummary,
  SpotifyGateway,
  TrackSearchResult,
} from "./types.js";

interface SpotifyToolGateway extends SpotifyGateway {
  listOwnedPlaylists(): Promise<OwnedPlaylistSummary[]>;
  searchTracks(query: string, limit?: number): Promise<TrackSearchResult[]>;
}
interface ServerDependencies {
  spotify: SpotifyToolGateway;
  playlistService: PlaylistService;
  tokenStore: TokenStore;
}

const playlistIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{22}$/)
  .describe("Spotify playlist ID, exactly 22 base62 characters");
const trackReferenceSchema = z
  .string()
  .min(1)
  .describe("Spotify track URI or open.spotify.com track URL");

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function safeHandler<Input>(handler: (input: Input) => Promise<unknown>) {
  return async (input: Input) => {
    try {
      return toolResult(await handler(input));
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: {
                code: "SPOTIFY_PLAYLIST_TOOL_ERROR",
                message:
                  error instanceof Error ? error.message : "Spotify tool failed",
              },
            }),
          },
        ],
      };
    }
  };
}

export function createSpotifyMcpServer(
  dependencies: ServerDependencies
): McpServer {
  const server = new McpServer(
    { name: "spotify-playlist-mcp", version: "0.1.0" },
    {
      instructions:
        "Inspect auth and playlist state before curating. All writes require an allowlisted, user-owned playlist. Create a short-lived plan with spotify_plan_playlist_changes, report its exact impact, then apply only that plan ID. Never infer permission for a different playlist or bypass the configured per-run change cap.",
    }
  );

  server.registerTool(
    "spotify_auth_status",
    {
      title: "Check Spotify authorization",
      description:
        "Check whether the one-time Spotify OAuth bootstrap exists and when its six-month refresh-token reauthorization is due. Never returns tokens.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safeHandler(async () => getAuthorizationStatus(dependencies.tokenStore))
  );

  server.registerTool(
    "spotify_list_owned_playlists",
    {
      title: "List owned Spotify playlists",
      description:
        "List playlists owned by the authenticated Spotify user, including visibility, item count, snapshot ID, and Spotify URL.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    safeHandler(async () => ({
      playlists: await dependencies.spotify.listOwnedPlaylists(),
    }))
  );

  server.registerTool(
    "spotify_search_tracks",
    {
      title: "Search Spotify tracks",
      description:
        "Search Spotify for tracks to consider during playlist curation. Returns compact, linked track metadata and performs no writes.",
      inputSchema: z.object({
        query: z.string().min(1).max(250),
        limit: z.number().int().min(1).max(10).default(10),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    safeHandler(async ({ query, limit }: { query: string; limit: number }) => ({
      tracks: await dependencies.spotify.searchTracks(query, limit),
    }))
  );

  server.registerTool(
    "spotify_get_playlist",
    {
      title: "Inspect a Spotify playlist",
      description:
        "Read current metadata and every playable track in an owned or collaborative Spotify playlist.",
      inputSchema: z.object({ playlist_id: playlistIdSchema }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    safeHandler(async ({ playlist_id }: { playlist_id: string }) => {
      const [playlist, items] = await Promise.all([
        dependencies.spotify.getPlaylistDetails(playlist_id),
        dependencies.spotify.getPlaylistItems(playlist_id),
      ]);
      return { playlist, items };
    })
  );

  server.registerTool(
    "spotify_plan_playlist_changes",
    {
      title: "Plan Spotify playlist changes",
      description:
        "Validate and preview bounded additions, removals, and metadata changes for an allowlisted owned playlist. This tool never writes and returns a short-lived plan ID.",
      inputSchema: z.object({
        playlist_id: playlistIdSchema,
        add_track_uris: z.array(trackReferenceSchema).max(100).default([]),
        remove_track_uris: z.array(trackReferenceSchema).max(100).default([]),
        details: z
          .object({
            name: z.string().min(1).max(100).optional(),
            description: z.string().max(300).optional(),
            public: z.boolean().optional(),
          })
          .optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    safeHandler(
      async ({
        playlist_id,
        add_track_uris,
        remove_track_uris,
        details,
      }: {
        playlist_id: string;
        add_track_uris: string[];
        remove_track_uris: string[];
        details?: { name?: string; description?: string; public?: boolean };
      }) =>
        dependencies.playlistService.planChanges({
          playlistId: playlist_id,
          addTrackUris: add_track_uris,
          removeTrackUris: remove_track_uris,
          ...(details ? { details } : {}),
        })
    )
  );

  server.registerTool(
    "spotify_apply_playlist_plan",
    {
      title: "Apply a Spotify playlist plan",
      description:
        "Apply one exact, unexpired plan created by spotify_plan_playlist_changes. The plan is single-use and fails if the playlist snapshot changed.",
      inputSchema: z.object({
        plan_id: z.string().uuid().or(z.string().min(1).max(200)),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    safeHandler(async ({ plan_id }: { plan_id: string }) =>
      dependencies.playlistService.applyPlan(plan_id)
    )
  );

  return server;
}
