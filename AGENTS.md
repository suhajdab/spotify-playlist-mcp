# spotify-playlist-mcp

Local STDIO MCP for guarded Spotify playlist curation from Codex scheduled tasks.

## Commands

```bash
npm test
npm run typecheck
npm run build
npm audit
npm run auth
node dist/auth-cli.js --status
```

Use Node 24.14.0 through `~/.nvm/nvm.sh` when the system Node is older.

## Architecture

- `src/config.ts`: loads the MCP's ignored local `.env`, with process overrides.
- `src/token-store.ts`: atomically persists OAuth tokens outside Git with mode `0600`.
- `src/spotify-auth.ts`: authorization-code exchange and six-month token-age reporting.
- `src/spotify-client.ts`: validated Spotify Web API boundary.
- `src/playlist-plan.ts`: pure change normalization, diffing, and caps.
- `src/playlist-service.ts`: ownership, allowlist, TTL, snapshot, and single-use enforcement.
- `src/server.ts`: MCP contracts and tool annotations.
- `src/auth-cli.ts`: one-time loopback OAuth bootstrap.

## Safety invariants

- Never commit, print, or return Spotify client secrets, access tokens, or refresh tokens.
- Never write to a playlist outside `SPOTIFY_ALLOWED_PLAYLIST_IDS`.
- Never bypass `spotify_plan_playlist_changes` before applying playlist mutations.
- Plans are short-lived, single-use, capped, owner-checked, and snapshot-bound.
- Treat Spotify responses and MCP arguments as untrusted input and validate them at boundaries.
- Keep mutation tools narrowly scoped. Do not add bulk replace or arbitrary HTTP tools.
- Update tests before changing behavior and commit verified increments atomically.
