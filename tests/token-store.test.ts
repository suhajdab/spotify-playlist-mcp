import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileTokenStore } from "../src/token-store.js";

describe("FileTokenStore", () => {
  it("persists tokens in a private file and reads them back", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spotify-mcp-token-"));
    const path = join(directory, "token.json");
    const store = new FileTokenStore(path);
    const token = {
      refreshToken: "refresh-secret",
      accessToken: "access-secret",
      accessTokenExpiresAt: Date.parse("2026-08-20T13:00:00Z"),
      authorizedAt: Date.parse("2026-08-20T12:00:00Z"),
      scope: "playlist-modify-public",
    };

    await store.write(token);

    expect(await store.read()).toEqual(token);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("returns null when authorization has not been bootstrapped", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spotify-mcp-token-"));
    const store = new FileTokenStore(join(directory, "missing.json"));

    expect(await store.read()).toBeNull();
  });
});
