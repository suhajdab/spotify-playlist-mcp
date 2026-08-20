import { z } from "zod";
import type { TokenStore } from "./token-store.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const REFRESH_TOKEN_LIFETIME_DAYS = 180;

export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
] as const;

const AuthorizationTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    scope: SPOTIFY_SCOPES.join(" "),
    redirect_uri: input.redirectUri,
    state: input.state,
  }).toString();
  return url.toString();
}
export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${input.clientId}:${input.clientSecret}`
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Spotify authorization failed with status ${response.status}`);
  }

  const token = AuthorizationTokenSchema.parse(await response.json());
  const authorizedAt = now();
  await input.tokenStore.write({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessTokenExpiresAt:
      authorizedAt + Math.max(0, token.expires_in - 60) * 1000,
    authorizedAt,
    scope: token.scope ?? SPOTIFY_SCOPES.join(" "),
  });
}

export async function getAuthorizationStatus(
  tokenStore: TokenStore,
  now: () => number = Date.now
) {
  const token = await tokenStore.read();
  if (!token) {
    return {
      isAuthorized: false,
      refreshTokenAgeDays: null,
      reauthorizationDueInDays: null,
      authorizedAt: null,
    };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const refreshTokenAgeDays = Math.max(
    0,
    Math.floor((now() - token.authorizedAt) / dayMs)
  );
  return {
    isAuthorized: refreshTokenAgeDays < REFRESH_TOKEN_LIFETIME_DAYS,
    refreshTokenAgeDays,
    reauthorizationDueInDays: Math.max(
      0,
      REFRESH_TOKEN_LIFETIME_DAYS - refreshTokenAgeDays
    ),
    authorizedAt: new Date(token.authorizedAt).toISOString(),
  };
}
