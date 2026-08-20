import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";

export interface AppConfig {
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyRedirectUri: string;
  tokenFile: string;
  allowedPlaylistIds: Set<string>;
  maxChangesPerPlan: number;
}

interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  envFile?: string;
}

function readEnvFile(path: string): Record<string, string> {
  try {
    return parse(readFileSync(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Unable to read Spotify environment file: ${path}`);
  }
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const environment = options.env ?? process.env;
  const envFile = options.envFile ?? join(process.cwd(), ".env");
  const fileValues = readEnvFile(envFile);
  const merged: Record<string, string | undefined> = {
    ...fileValues,
    ...environment,
  };

  const spotifyClientId = required(merged, "SPOTIFY_CLIENT_ID");
  const spotifyClientSecret = required(merged, "SPOTIFY_CLIENT_SECRET");
  const spotifyRedirectUri = required(merged, "SPOTIFY_REDIRECT_URI");
  const redirect = new URL(spotifyRedirectUri);
  if (
    redirect.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(redirect.hostname)
  ) {
    throw new Error("SPOTIFY_REDIRECT_URI must be an HTTP loopback URL");
  }

  const maxChangesPerPlan = Number(
    merged.SPOTIFY_MAX_CHANGES_PER_PLAN ?? "10"
  );
  if (
    !Number.isInteger(maxChangesPerPlan) ||
    maxChangesPerPlan < 1 ||
    maxChangesPerPlan > 100
  ) {
    throw new Error("SPOTIFY_MAX_CHANGES_PER_PLAN must be between 1 and 100");
  }

  const allowedPlaylistIds = new Set(
    (merged.SPOTIFY_ALLOWED_PLAYLIST_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  for (const playlistId of allowedPlaylistIds) {
    if (!/^[A-Za-z0-9]{22}$/.test(playlistId)) {
      throw new Error(`Invalid Spotify playlist ID in allowlist: ${playlistId}`);
    }
  }

  return {
    spotifyClientId,
    spotifyClientSecret,
    spotifyRedirectUri,
    tokenFile:
      merged.SPOTIFY_TOKEN_FILE ??
      join(homedir(), ".config", "spotify-playlist-mcp", "token.json"),
    allowedPlaylistIds,
    maxChangesPerPlan,
  };
}
