# HEXTRA — AI Agent Termux-First (Hermes Logic + OpenCode Render, Full TS)

P0 scaffold. See `MASTERPLAN.md` for the full plan.

## Quick start

```sh
npm install
npm run typecheck
npm run build
node apps/tui/dist/app.js doctor
node apps/tui/dist/app.js setup
node apps/tui/dist/app.js
```

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

Commits: English only, SSH-signed (Verified).
