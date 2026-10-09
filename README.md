# HEXTRA — AI Agent Termux-First (Hermes Logic + OpenCode Render, Full TS)

P0 scaffold. See `MASTERPLAN.md` for the full plan.

## Install

Desktop/server (prebuilt binary):

```sh
curl -fsSL https://github.com/Mercphobia/hextra/releases/latest/download/install.sh | bash
```

Termux (fully automatic source install — clone, build, wrapper in `$PREFIX/bin`):

```sh
curl -fsSL https://github.com/Mercphobia/hextra/releases/latest/download/install.sh | bash
```

Rerun the same command to update. Then `hextra setup`, `hextra`.

## P2 commands

```sh
node apps/tui/dist/app.js cron add --every 60 -- "summarize workspace"
node apps/tui/dist/app.js cron add --at 07:00 -- "daily report"
node apps/tui/dist/app.js cron list
node apps/tui/dist/app.js cron tick   # run due jobs (Termux scheduler calls this)
```

MCP servers (optional, `~/.config/hextra/config.json`):

```json
{ "mcpServers": [{ "name": "files", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], "allow": ["read_file"] }] }
```

Memory recall is ranked FTS; turns using 3+ tools auto-save a skill when `autoSkill` is on.

## Release (single binary)

```sh
curl -fsSL https://github.com/Mercphobia/hextra/releases/latest/download/install.sh | bash
hextra update   # self-update from GitHub releases
```

Local SEA build needs Node >= 25.5 (`mainFormat: module`): `./scripts/build-sea.sh`.
Tag `v*` triggers CI (linux x64+arm64, darwin arm64) via `.github/workflows/release.yml`.

Commits: English only, SSH-signed (Verified).
