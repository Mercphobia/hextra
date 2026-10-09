# HEXTRA — AI Agent Termux-First (Hermes Logic + OpenCode Render, Full TS)

> V1: 100% TypeScript, Termux ARM64. Python hanya worker opsional V2.
> LLM utama: OpenAI-Compatible `/v1`. TUI wajib mirip OpenCode. Installer mirip OpenCode/Hermes.

## 1. Referensi Hermes Agent (NousResearch/hermes-agent, Python, MIT)

### 1.1 System Overview asli
```
Entry: cli.py | gateway/run.py | acp_adapter/ | batch_runner.py | API server
  -> AIAgent run_agent.py:
     Prompt Builder (prompt_builder.py)
     Provider Resolution (runtime_provider.py) — 18+ provider, 3 API mode: chat_completions / codex_responses / anthropic_messages
     Tool Dispatch (model_tools.py) — 70+ tools, 28 toolsets via tools/registry.py
     Compression & Caching (context_compressor.py, prompt_caching.py)
  -> Session Storage: SQLite + FTS5 (hermes_state.py + 30 file hermes_state_*.py)
  -> Tool Backends: Terminal 7 (local/docker/ssh/modal/daytona/singularity/vercel-sandbox), Browser 5, Web 4, MCP dynamic, File, Vision
```

### 1.2 Data Flow asli
- CLI: `input -> HermesCLI.process_input -> AIAgent.run_conversation -> build prompt -> resolve provider -> API call -> tool_calls loop -> display -> save SessionDB`
- Gateway: `platform event -> Adapter.on_message -> GatewayRunner._handle_message -> authorize -> session key -> AIAgent -> deliver via adapter`
- Cron: `tick -> load jobs.json -> fresh AIAgent + skills inject -> run -> deliver -> update next_run`

### 1.3 Directory penting asli
```
run_agent.py, cli.py, model_tools.py, toolsets.py, hermes_state.py, hermes_constants.py
agent/ (prompt_builder, context_engine, context_compressor, memory_manager, trajectory)
hermes_cli/ (main, config, auth, models, model_switch, setup.py+setup_*.py, gateway, tools_config, skills_config, plugins)
tools/ (registry.py + terminal_tool, file_tools, web_tools, browser_tool, code_execution, delegate, mcp_tool, environments/)
gateway/ (run.py+run_*.py, session.py, delivery.py, pairing.py, hooks.py) + plugins/platforms/ (20+: telegram discord slack whatsapp signal matrix email sms dingtalk feishu wecom irc line teams dll)
cron/ (jobs.py scheduler.py), skills/ + optional-skills/, plugins/memory/ + plugins/context_engine/
ui-tui/ + tui_gateway/, acp_adapter/, evals/, tests/ (~25k tests)
install.sh + install.ps1 + Termux APT repo (aarch64 stable/canary, bundel Python+Node+TUI)
```

### 1.4 Prinsip desain Hermes (dipertahankan)
prompt stabil, observable execution, interruptible, core agnostik platform, loose coupling registry, profile isolation per HERMES_HOME.

### 1.5 Fitur Hermes wajib di-port
Connect 20+ platform satu gateway, Remember closed learning loop (memory nudge + auto-skill + skill self-improve + FTS5 recall + Honcho user modeling, format agentskills.io), Schedule cron delivery ke platform mana pun, Bot Mode (named bots model/memory/skills/routine sendiri + peer DM), Delegate subagent paralel + execute_code RPC, 7 terminal backend, MCP + filter, Trajectory export RL-ready, `hermes setup --portal`, `hermes model/tools/config/gateway/doctor/update`, migrasi OpenClaw.

## 2. Referensi OpenCode (sst/opencode, TypeScript 74.5%, MIT)

- Base: TypeScript + Bun + Solid + Vite + OpenTUI (core Zig + binding TS). Bukan Python.
- TUI: multiline edit, autocomplete `/`, history, interrupt-redirect, streaming tool output, sidebar session, diff view, permission modal, statusbar model/token/latensi, theme + keybind vim/default.
- Store: SQLite lokal. LSP code intelligence. MCP + legacy SDK compat.
- Install: `curl -fsSL .../install | bash`, `npm i -g opencode`, brew, paru. Detect OS/ARCH, symlink `~/.opencode/bin`.
- Alasan dipakai: ringan, 1 binary, gampang port android-arm64 Termux.

## 3. Arsitektur gabungan (port TS)

```
tui/cli/gateway (TS Ink/OpenTUI)
  -> core/AIAgent (agent-loop.ts):
     prompt-builder.ts (stable->context->volatile)
     llm/openai-client.ts (fetch SSE /v1/chat/completions, retry 3x, timeout 60s)
     llm/router.ts (cloud utama -> fallback lokal, per-bot override)
     compression.ts (summarize >80%), tool-dispatch via registry.ts
  -> tools (15 MVP -> 60+): read edit glob grep shell-safe webfetch websearch todo memory-save skill-save session config cron-add mcp-call diff-apply
  -> memory (node:sqlite + FTS5 + sqlite-vec + skills/*.md)
  -> cron (jobs.json + scheduler + delivery) + bot-mode (bots.json)
```

Termux constraint: no Docker/Postgres/Redis/systemd. Ganti: sandbox path `$HOME/agent-workspace`, SQLite file, `termux-wake-lock + termux-services`, semua path relative `$HOME`.

## 4. Struktur repo TS
```
/apps/tui/src/{app.tsx, screens/chat.tsx, components/{session-list, message-view, tool-badge, diff-view, permission-modal, status-bar, model-picker}.tsx, wizard/{schema.ts, ui.tsx, provider-test.ts, storage.ts}}
/packages/core/src/{agent-loop.ts, prompt-builder.ts, llm/openai-client.ts, llm/router.ts, compression.ts, bot.ts, cron.ts, session.ts, config.ts}
/packages/tools/src/{registry.ts, fs.ts, shell.ts, web.ts, mcp.ts}
/packages/memory/src/{db.ts, fts.ts, skills.ts}
/scripts/{install.sh, install.ps1}
MASTERPLAN.md
```

Dependency chain tiru Hermes: `tools/registry.ts (no deps) <- tools/*.ts self-register <- core/agent-loop <- tui/gateway`.

## 5. LLM OpenAI-Compatible only
```env
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=...
OPENAI_MODEL=nous-hermes-xxx
FALLBACK_BASE_URL=http://127.0.0.1:11434/v1
FALLBACK_MODEL=qwen3:4b
```
Wajib support: `stream:true, tools function-calling, response_format json`, token budget guard untuk HP.

## 6. Setup Wizard (logic Hermes, render OpenCode)

State `~/.config/agent/wizard.json` (resumeable). 9 step:
1. welcome: cek arch arm64/x64, node, termux-storage, wake-lock
2. auth: cloud key / local / portal OAuth
3. provider-openai: baseURL/apiKey/model + Test `GET /v1/models` + chat mini 5 token
4. model+fallback: utama cloud, fallback Ollama/LM Studio, allow skip
5. memory: init `~/.local/share/agent/memory.db` + `skills/` + SOUL.md
6. connect: CLI ON default, simpan token Telegram/Discord/Slack/WA (gateway aktif V1.1)
7. skills+mcp: auto-skill ON/OFF, add MCP server, allowlist default deny-dangerous
8. schedule: cron ON/OFF + contoh daily report
9. verify: save config.json 600, e2e chat test, ringkasan + `agent tui`

Render modal fullscreen gaya OpenCode: header-status, step-sidebar, form-input, footer `↑↓ Enter Esc /test`. Re-run: `agent setup`, `/setup`, `agent setup --reset`, `agent doctor`.

Mock:
```
┌ setup ─ step 2/9 provider ─ arm64 ──────────────┐
│ > BaseURL [https://openrouter.ai/api/v1]        │
│   API Key [********]               [Test ✓]     │
│   Model   [nous-hermes-2-mistral-7b v]          │
│   ↑↓ Enter next Esc back                        │
└─────────────────────────────────────────────────┘
```

## 7. TUI utama (wajib mirip OpenCode)
```
┌ agent ─ qwen3:4b ● ─────────────────────────────┐
│ session: termux-fix tokens:12k/128k             │
│ you: benerin wifi drop                          │
│ ai▸ cek log...                                  │
│ [tool shell] done 0.8s                          │
│ > ketik... /model /setup /skill                 │
└─────────────────────────────────────────────────┘
```
Fitur: streaming, tool badge running/done, diff-view, permission `allow once/allowlist/deny`, `/new /reset /model /retry /undo /compress /usage /skills /stop`, interrupt Ctrl+C.

## 8. Installer + ARM64 (mirip OpenCode/Hermes)
Build SEA Node22: `linux-x64, linux-arm64, android-arm64, darwin-arm64`. Wajib `node:sqlite` bawaan, no native dep.
`install.sh`: `detect OSTYPE + uname -m (aarch64->arm64) -> download agent-$OS-$ARCH.tar.gz -> ~/.agent/bin + symlink ~/.local/bin atau $PREFIX/bin (Termux) -> agent setup -> agent doctor`. Termux: `pkg install nodejs git openssh`, `termux-setup-storage`, `termux-wake-lock`.

## 9. Fase build
- P0 2 hari: bootstrap pnpm/ts strict/sqlite, TUI shell, wizard 1-2-9
- P1 1 minggu: loop streaming + tool loop 10 tools + permission + session
- P2: memory FTS + skills auto-generate + MCP filtered + cron jobs.json
- V1 freeze: stabil offline-tolerant Termux
- V1.1 gateway Telegram/Discord/WA, V1.2 bot-mode + scheduler delivery, V2 coding full (LSP/test-runner) + multi-agent planner-coder-reviewer, V2.1 worker-py RAG/eval (opsional HTTP), V2.2 Postgres/pgvector/Redis/Docker/K8s + RBAC/audit + hardening CVE Hermes (path traversal, auth bypass), V2.3 voice/vision/marketplace + trajectory export

## 10. Upgrade path desktop/VPS
Binary sama tinggal `scp ~/.config/agent + memory.db` ke VPS, `systemctl enable agent`, `agent gateway start`. Desktop: systemd user + Tauri wrap opsional tanpa ubah core.
