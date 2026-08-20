# Spotify Playlist MCP

A local STDIO MCP server for safely curating Spotify playlists from Codex desktop scheduled tasks. It can inspect owned playlists, search Spotify tracks, update playlist metadata, and add or remove tracks through a bounded plan/apply workflow.

## Safety model

- Reads Spotify credentials and safety settings only from this project's ignored `.env`, with optional process-level overrides.
- Stores the OAuth token at `~/.config/spotify-playlist-mcp/token.json` with file mode `0600`.
- Refuses every write unless the playlist ID appears in `SPOTIFY_ALLOWED_PLAYLIST_IDS`.
- Verifies that the authenticated user owns the playlist.
- Caps each plan with `SPOTIFY_MAX_CHANGES_PER_PLAN`, default `10` affected tracks.
- Binds plans to the current Spotify `snapshot_id`, expires them after 10 minutes, and permits one application only.
- Consumes a plan before the first write so a partially applied operation cannot be retried accidentally.

Spotify refresh tokens currently expire six months after authorization. `spotify_auth_status` reports the remaining time so a scheduled task can warn before reauthorization is required. See Spotify's [refresh-token guide](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens).

## Tools

| Tool | Type | Purpose |
|---|---|---|
| `spotify_auth_status` | Read | Report authorization and refresh-token age without returning credentials |
| `spotify_list_owned_playlists` | Read | List owned playlists, visibility, counts, snapshots, and links |
| `spotify_search_tracks` | Read | Search for candidate tracks, maximum 10 results per request |
| `spotify_get_playlist` | Read | Return current playlist metadata and playable track items |
| `spotify_plan_playlist_changes` | Read | Validate and preview additions, removals, name, description, or visibility changes |
| `spotify_apply_playlist_plan` | Write | Apply one exact, unexpired, single-use plan |

Track additions are appended. URI removals remove every matching occurrence, and the impact count reflects that behavior. The server intentionally does not expose bulk replacement, arbitrary requests, playlist deletion, or unplanned writes.

## Install and verify

```bash
source ~/.nvm/nvm.sh
nvm use 24.14.0
npm install
npm test
npm run typecheck
npm run build
npm audit
```

## One-time Spotify authorization

The redirect URI in `.env` must exactly match the Spotify Dashboard setting. The current loopback callback is `http://127.0.0.1:3000/auth/callback`.

```bash
npm run auth
```

Open the printed Spotify URL and approve the scopes. The command receives the loopback callback and saves the token privately. Check status without revealing credentials:

```bash
node dist/auth-cli.js --status
```

Spotify currently requires reauthorization every six months because refreshing an access token does not extend the refresh token lifetime.

## Codex desktop configuration

The desktop app, CLI, and IDE extension share `~/.codex/config.toml`. A scheduled desktop task can launch this STDIO server directly:

```toml
[mcp_servers.spotify-playlists]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/spotify-playlist-mcp/dist/index.js"]
cwd = "/absolute/path/to/spotify-playlist-mcp"
enabled = true
required = true
default_tools_approval_mode = "auto"
tool_timeout_sec = 60

[mcp_servers.spotify-playlists.env]
SPOTIFY_ALLOWED_PLAYLIST_IDS = "replace-with-owned-playlist-id"
SPOTIFY_MAX_CHANGES_PER_PLAN = "10"

[mcp_servers.spotify-playlists.tools.spotify_apply_playlist_plan]
approval_mode = "approve"
```

Restart the ChatGPT desktop app after changing MCP configuration. Keep the computer on and the app running when a scheduled task needs the local server. See the official [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp) and [scheduled tasks](https://learn.chatgpt.com/docs/automations) documentation.

Leave `SPOTIFY_ALLOWED_PLAYLIST_IDS` empty until the intended public playlist exists and its exact ID has been reviewed. Multiple IDs may be comma-separated.

## Suggested scheduled-task prompt

```text
Use the Spotify playlist MCP to curate only the configured allowlisted playlist.
First check spotify_auth_status and stop with a warning when authorization is missing or due within 14 days.
Inspect the current playlist before searching for candidates.
Follow the playlist's stated audience and description.
Do not remove protected anchor tracks unless the task prompt explicitly names them.
Make no more than the configured change cap.
Create a playlist change plan, report its additions, removals, metadata updates, and warnings, then apply that exact plan only when it matches these rules.
Report the final snapshot ID and Spotify link.
```

Test this prompt manually before scheduling it. Scheduled runs are unattended, so the mutation tool must not be configured to prompt for approval.

## Development

```bash
npm test
npm run typecheck
npm run build
```

Tests use in-memory Spotify fakes and an in-memory MCP transport. No test calls Spotify or reads the real token file.

## License

[MIT](LICENSE)
