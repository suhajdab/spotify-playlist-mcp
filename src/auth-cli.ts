#!/usr/bin/env node
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { loadConfig } from "./config.js";
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  getAuthorizationStatus,
} from "./spotify-auth.js";
import { FileTokenStore } from "./token-store.js";

const config = loadConfig();
const tokenStore = new FileTokenStore(config.tokenFile);

if (process.argv.includes("--status")) {
  process.stdout.write(
    `${JSON.stringify(await getAuthorizationStatus(tokenStore), null, 2)}\n`
  );
  process.exit(0);
}

const redirect = new URL(config.spotifyRedirectUri);
const port = Number(redirect.port);
if (!Number.isInteger(port) || port < 1) {
  throw new Error("SPOTIFY_REDIRECT_URI must include an explicit loopback port");
}
const state = randomBytes(24).toString("hex");
const authorizationUrl = buildAuthorizationUrl({
  clientId: config.spotifyClientId,
  redirectUri: config.spotifyRedirectUri,
  state,
});

const completed = new Promise<void>((resolve, reject) => {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", redirect.origin);
    if (requestUrl.pathname !== redirect.pathname) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const returnedState = requestUrl.searchParams.get("state");
    const code = requestUrl.searchParams.get("code");
    const spotifyError = requestUrl.searchParams.get("error");
    try {
      if (spotifyError) throw new Error(`Spotify denied authorization: ${spotifyError}`);
      if (!returnedState || returnedState !== state) {
        throw new Error("Spotify OAuth state mismatch");
      }
      if (!code) throw new Error("Spotify callback did not include an authorization code");
      await exchangeAuthorizationCode({
        code,
        clientId: config.spotifyClientId,
        clientSecret: config.spotifyClientSecret,
        redirectUri: config.spotifyRedirectUri,
        tokenStore,
      });
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Spotify authorization saved. You can close this window.");
      process.stderr.write("Spotify authorization saved successfully.\n");
      server.close(() => resolve());
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Spotify authorization failed. Return to the terminal for details.");
      server.close(() =>
        reject(error instanceof Error ? error : new Error("Authorization failed"))
      );
    }
  });

  server.once("error", reject);
  server.listen(port, redirect.hostname, () => {
    process.stderr.write(
      `Open this URL to authorize Spotify:\n\n${authorizationUrl}\n\n`
    );
    process.stderr.write(`Waiting for ${config.spotifyRedirectUri}\n`);
  });
});

await completed;
