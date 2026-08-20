import { describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  getAuthorizationStatus,
  SPOTIFY_SCOPES,
} from "../src/spotify-auth.js";
import type { TokenRecord, TokenStore } from "../src/token-store.js";

class MemoryTokenStore implements TokenStore {
  token: TokenRecord | null = null;
  async read(): Promise<TokenRecord | null> {
    return this.token;
  }
  async write(token: TokenRecord): Promise<void> {
    this.token = token;
  }
}

describe("Spotify authorization", () => {
  it("builds a state-bound authorization URL with playlist scopes", () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: "client-id",
        redirectUri: "http://127.0.0.1:3000/auth/callback",
        state: "random-state",
      })
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.spotify.com/authorize"
    );
    expect(url.searchParams.get("state")).toBe("random-state");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/auth/callback"
    );
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(
      [...SPOTIFY_SCOPES].sort()
    );
  });

  it("exchanges a code and stores only the resulting token record", async () => {
    const store = new MemoryTokenStore();
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: "access-secret",
          refresh_token: "refresh-secret",
          token_type: "Bearer",
          expires_in: 3600,
          scope: SPOTIFY_SCOPES.join(" "),
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );

    await exchangeAuthorizationCode({
      code: "authorization-code",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://127.0.0.1:3000/auth/callback",
      tokenStore: store,
      fetchImpl,
      now: () => 10_000,
    });

    expect(store.token).toEqual({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      accessTokenExpiresAt: 3_550_000,
      authorizedAt: 10_000,
      scope: SPOTIFY_SCOPES.join(" "),
    });
  });

  it("reports refresh-token reauthorization age without exposing tokens", async () => {
    const store = new MemoryTokenStore();
    store.token = {
      refreshToken: "refresh-secret",
      authorizedAt: 1_000,
      scope: SPOTIFY_SCOPES.join(" "),
    };

    const status = await getAuthorizationStatus(
      store,
      () => 1_000 + 30 * 24 * 60 * 60 * 1000
    );

    expect(status.isAuthorized).toBe(true);
    expect(status.refreshTokenAgeDays).toBe(30);
    expect(status.reauthorizationDueInDays).toBe(150);
    expect(JSON.stringify(status)).not.toContain("refresh-secret");
  });
});
