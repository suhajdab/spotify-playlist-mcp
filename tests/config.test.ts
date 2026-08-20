import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads credentials and safety settings from one local environment file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spotify-mcp-config-"));
    const envFile = join(directory, ".env");
    await writeFile(
      envFile,
      [
        "SPOTIFY_CLIENT_ID=local-client-id",
        "SPOTIFY_CLIENT_SECRET=local-client-secret",
        "SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/auth/callback",
        "SPOTIFY_ALLOWED_PLAYLIST_IDS=0123456789ABCDEFGHIJKL, ZYXWVUTSRQPONMLKJIHGFE",
        "SPOTIFY_MAX_CHANGES_PER_PLAN=7",
        `SPOTIFY_TOKEN_FILE=${join(directory, "token.json")}`,
        "SESSION_SECRET=must-not-be-loaded",
      ].join("\n")
    );

    const config = loadConfig({
      env: {},
      envFile,
    });

    expect(config.spotifyClientId).toBe("local-client-id");
    expect(config.spotifyClientSecret).toBe("local-client-secret");
    expect(config.allowedPlaylistIds).toEqual(
      new Set(["0123456789ABCDEFGHIJKL", "ZYXWVUTSRQPONMLKJIHGFE"])
    );
    expect(config.maxChangesPerPlan).toBe(7);
    expect(config).not.toHaveProperty("sessionSecret");
  });

  it("rejects missing credentials and malformed safety settings", () => {
    expect(() =>
      loadConfig({ env: {}, envFile: "/does/not/exist" })
    ).toThrow("SPOTIFY_CLIENT_ID");

    expect(() =>
      loadConfig({
        env: {
          SPOTIFY_CLIENT_ID: "id",
          SPOTIFY_CLIENT_SECRET: "secret",
          SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/auth/callback",
          SPOTIFY_MAX_CHANGES_PER_PLAN: "0",
        },
        envFile: "/does/not/exist",
      })
    ).toThrow("between 1 and 100");
  });
});
