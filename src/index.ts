#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { PlaylistService } from "./playlist-service.js";
import { createSpotifyMcpServer } from "./server.js";
import { SpotifyClient } from "./spotify-client.js";
import { FileTokenStore } from "./token-store.js";

const config = loadConfig();
const tokenStore = new FileTokenStore(config.tokenFile);
const spotify = new SpotifyClient({
  clientId: config.spotifyClientId,
  clientSecret: config.spotifyClientSecret,
  tokenStore,
});
const playlistService = new PlaylistService(spotify, {
  allowedPlaylistIds: config.allowedPlaylistIds,
  maxChangesPerPlan: config.maxChangesPerPlan,
});
const server = createSpotifyMcpServer({ spotify, playlistService, tokenStore });

await server.connect(new StdioServerTransport());
