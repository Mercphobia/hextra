#!/usr/bin/env node
import { createInterface } from "node:readline";
import {
  loadConfig, saveConfig, defaultWorkspace, DEFAULT_BASE_URL, configPath, type HextraConfig,
} from "@hextra/core/config.js";
import { testConnection, type ChatMessage } from "@hextra/core/llm/openai-client.js";
import { runAgentLoop, compressHistory } from "@hextra/core/agent-loop.js";
import { addBot, getBot, loadBots, removeBot, type BotProfile } from "@hextra/core/bots.js";
import { addJob, dueJobs, loadJobs, markRun } from "@hextra/core/cron.js";
import { buildSystemPrompt } from "@hextra/core/prompt-builder.js";
import { listSchemas, handlers, registerTool } from "@hextra/tools/registry.js";
import { connectMcpServers } from "@hextra/tools/mcp.js";
import { decide, loadPolicy, savePolicy, parseApprovalAnswer } from "@hextra/tools/permissions.js";
import { recallMemory, saveMemory } from "@hextra/memory/db.js";
import { listSkills, loadSkills, saveSkill } from "@hextra/memory/skills.js";
import { wireTools } from "@hextra/tools/wiring.js";
import { appendFileSync, statSync, existsSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { HEXTRA_VERSION } from "./version.js";
import { join } from "node:path";
import { dataDir } from "@hextra/core/config.js";
import { audit } from "@hextra/core/audit.js";
import { clampInput, redactSecrets } from "@hextra/core/secrets.js";

function ask(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a: string) => resolve(a.trim())));
}

async function cmdSetup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const step = (n: number, name: string) => console.log(`\n[setup ${n}/9] ${name}`);
  console.log("hextra setup — Hermes logic, OpenCode-style prompts. Empty answer = default [in brackets].");

  step(1, "welcome: environment check");
  console.log(`node ${process.version} ${process.arch} ${process.platform}`);
  console.log(`termux: ${process.env.TERMUX_VERSION ?? "no"}`);
  try {
    mkdirSync(defaultWorkspace(), { recursive: true });
    console.log(`workspace writable: ${defaultWorkspace()}`);
  } catch (e) {
    console.log(`workspace NOT writable: ${e instanceof Error ? e.message : String(e)}`);
  }

  step(2, "auth: cloud API key or local endpoint");
  const local = (await ask(rl, "Use local endpoint (Ollama/LM Studio)? [n]: ")).toLowerCase();
  const isLocal = ["y", "yes"].includes(local);
  const defBase = isLocal ? "http://127.0.0.1:11434/v1" : DEFAULT_BASE_URL;

  step(3, "provider: OpenAI-compatible endpoint + live test");
  const baseUrl = (await ask(rl, `BaseURL [${defBase}]: `)) || defBase;
  const apiKey = isLocal ? "local" : await ask(rl, "API key: ");
  const model = (await ask(rl, "Model [default]: ")) || "default";
  if (!isLocal && !apiKey) {
    console.log("API key required for cloud primary. Aborted.");
    rl.close();
    return;
  }
  const t = await testConnection({ baseUrl, apiKey, model });
  console.log(`connection test: ${t.ok ? "OK" : "FAIL"} — ${t.detail}`);

  step(4, "fallback model (optional, used when primary is unreachable)");
  const fallbackBaseUrl = await ask(rl, "Fallback baseURL [skip]: ");
  const fallbackModel = fallbackBaseUrl ? (await ask(rl, "Fallback model [qwen3:4b]: ")) || "qwen3:4b" : undefined;

  step(5, "memory: local file store + skills directory");
  console.log(`memory: ~/.local/share/hextra/memory.jsonl (ranked FTS, auto-redacted)`);
  console.log(`skills: ~/.config/hextra/skills/*.md (auto-skill on success)`);
  const autoSkill = (await ask(rl, "Auto-save skills from 3+ tool turns? [Y/n]: ")).toLowerCase();

  step(6, "connect: messaging platforms (gateway comes later, tokens stored now)");
  console.log("CLI is always on. Tokens below are stored for the future gateway.");
  const telegramBotToken = (await ask(rl, "Telegram bot token [skip]: ")) || undefined;
  const discordBotToken = (await ask(rl, "Discord bot token [skip]: ")) || undefined;

  step(7, "skills + MCP servers");
  const mcpServers: HextraConfig["mcpServers"] = [];
  for (;;) {
    const name = await ask(rl, "Add MCP server name [done]: ");
    if (!name) break;
    const command = (await ask(rl, `Command for ${name} [npx]: `)) || "npx";
    const argsRaw = await ask(rl, "Args (space separated) [none]: ");
    const allowRaw = await ask(rl, "Tool allowlist (comma separated, empty = all) [all]: ");
    mcpServers.push({
      name,
      command,
      args: argsRaw ? argsRaw.split(/\s+/) : [],
      allow: allowRaw ? allowRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    });
  }

  step(8, "schedule: cron jobs");
  if (process.env.TERMUX_VERSION) {
    console.log("hint: keep Termux alive with `termux-wake-lock`; run `hextra cron tick` from Termux:JobScheduler or a loop.");
  } else {
    console.log("hint: run `hextra cron tick` from systemd timer / cron to execute due jobs.");
  }
  const ex = (await ask(rl, 'Add example daily job "summarize workspace" at 07:00? [n]: ')).toLowerCase();
  let exampleJob = "";
  if (["y", "yes"].includes(ex)) {
    exampleJob = addJob("summarize workspace", { at: "07:00" }).id;
    console.log(`added example job ${exampleJob}`);
  }

  step(9, "verify + save");
  const workspace = (await ask(rl, `Workspace [${defaultWorkspace()}]: `)) || defaultWorkspace();
  const cfg: HextraConfig = {
    baseUrl, apiKey, model,
    fallbackBaseUrl: fallbackBaseUrl || undefined,
    fallbackModel,
    workspace, theme: "dark",
    autoSkill: !["n", "no"].includes(autoSkill),
    telegramBotToken, discordBotToken,
    mcpServers: mcpServers.length ? mcpServers : undefined,
  };
  saveConfig(cfg);
  const v = await testConnection({ baseUrl, apiKey, model });
  console.log(`final check: ${v.ok ? "OK" : "FAIL"} — ${v.detail}`);
  console.log("saved to ~/.config/hextra/config.json (0600).");
  console.log(`summary: model=${model} workspace=${workspace} mcp=${mcpServers.length} cron_example=${exampleJob || "none"}`);
  console.log("next: `hextra` to chat, `hextra tui` for panels, `hextra doctor` to re-check.");
  rl.close();
}

async function cmdDoctor(): Promise<void> {
  console.log(`node: ${process.version} arch: ${process.arch} platform: ${process.platform}`);
  console.log(`config: ${loadConfig() ? "found" : "missing — run 'hextra setup'"}`);
  try {
    const st = statSync(configPath());
    const mode = (st.mode & 0o777).toString(8);
    console.log(`config perms: ${mode}${mode === "600" ? " (ok)" : " (warn: want 600)"}`);
  } catch {
    console.log("config perms: n/a");
  }
  console.log(`TERMUX_VERSION: ${process.env.TERMUX_VERSION ?? "(not termux)"}`);
}

const HELP = [
  "/new — fresh session",
  "/model <name> — switch cloud model",
  "/bot <name> — switch specialist bot",
  "/skills — list saved skills",
  "/usage — rough token estimate of this session",
  "/undo — drop last turn",
  "/compress — summarize session to save context",
  "/setup — re-run setup wizard",
  "/quit — exit",
].join("\n");

async function cmdChat(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) {
    console.log("No config. Run 'hextra setup' first.");
    return;
  }
  wireTools(cfg.workspace);
  const mcp = await connectMcpServers(cfg.mcpServers ?? []);
  for (const w of mcp.warnings) console.log(`mcp warn: ${w}`);
  for (const s of mcp.schemas) {
    registerTool(s.function.name, s.function.description, s.function.parameters, mcp.handlers[s.function.name]);
  }
  if (mcp.schemas.length) console.log(`mcp: ${mcp.schemas.length} tools from ${mcp.clients.length} servers`);
  const policy = loadPolicy();
  const sessionGrants = new Set<string>();
  let history: ChatMessage[] = [];
  let toolCount = 0;
  let activeBot: BotProfile | null = null;
  const system = () => buildSystemPrompt({
    identity: activeBot?.system,
    skills: loadSkills(),
    memory: recallMemory("project", 5, activeBot?.name ?? ""),
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "hextra> " });

  const approve = async (tool: string, args: string): Promise<boolean> => {
    const d = decide(policy, sessionGrants, tool);
    if (d === "allow") return true;
    if (d === "deny") {
      console.log(`\n[deny] ${tool} blocked by policy`);
      audit({ tool, args, phase: "denied" });
      return false;
    }
    const ans = parseApprovalAnswer(await ask(rl, `\n[permission] ${tool} ${redactSecrets(args).slice(0, 120)} — (a)llow once / al(w)ays / (d)eny [a]: `));
    if (ans === "always") {
      policy.allow.push(tool);
      savePolicy(policy);
      return true;
    }
    if (ans === "once") {
      sessionGrants.add(tool);
      return true;
    }
    return false;
  };

  console.log("10 tools ready. /help for commands.");
  rl.on("close", () => mcp.clients.forEach((c) => c.stop()));
  rl.prompt();
  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) return rl.prompt();
    if (input === "/quit" || input === "/exit") return rl.close();
    if (input === "/help") {
      console.log(HELP);
      return rl.prompt();
    }
    if (input === "/new") {
      history = [];
      sessionGrants.clear();
      console.log("(fresh session)");
      return rl.prompt();
    }
    if (input === "/skills") {
      console.log(listSkills().join("\n") || "(no skills)");
      return rl.prompt();
    }
    if (input === "/usage") {
      const chars = history.reduce((n, m) => n + m.content.length, 0);
      console.log(`~${Math.round(chars / 4)} tokens in session history`);
      return rl.prompt();
    }
    if (input === "/undo") {
      history = history.slice(0, -2);
      console.log("(last turn dropped)");
      return rl.prompt();
    }
    if (input === "/compress") {
      const turnCfg = activeBot?.model ? { ...cfg, model: activeBot.model } : cfg;
      console.log("(compressing…)");
      try {
        history = await compressHistory(turnCfg, history);
        console.log("(session compressed)");
      } catch (e) {
        console.log(`compress failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return rl.prompt();
    }
    if (input.startsWith("/model ")) {
      cfg.model = input.slice(7).trim();
      saveConfig(cfg);
      console.log(`model -> ${cfg.model}`);
      return rl.prompt();
    }
    if (input === "/bot" || input.startsWith("/bot ")) {
      const name = input.slice(4).trim();
      if (!name) {
        console.log(loadBots().map((b) => `${b.name}${b.model ? ` (${b.model})` : ""}`).join("\n") || "(no bots — hextra bot add)");
        return rl.prompt();
      }
      const bot = getBot(name);
      if (!bot) {
        console.log(`no bot '${name}'`);
        return rl.prompt();
      }
      activeBot = bot;
      history = [];
      console.log(`bot -> ${bot.name}${bot.model ? ` (model ${bot.model})` : ""}`);
      return rl.prompt();
    }
    if (input === "/setup") {
      rl.close();
      void cmdSetup();
      return;
    }
    toolCount = 0;
    const { text: clamped, truncated } = clampInput(input);
    if (truncated) console.log(`(input clamped to ${clamped.length} chars)`);
    let gotToken = false;
    const waiter = setTimeout(() => {
      if (!gotToken) console.log("(waiting for server…)");
    }, 10_000);
    const lastArgs = new Map<string, string>();
    const approveWithAudit = async (tool: string, args: string): Promise<boolean> => {
      lastArgs.set(tool, args);
      return approve(tool, args);
    };
    void runAgentLoop({
      cfg: activeBot?.model ? { ...cfg, model: activeBot.model } : cfg, system: system(), input: clamped, history, tools: listSchemas(), handlers: handlers(), approve: approveWithAudit,
      onToken: (t: string) => {
        gotToken = true;
        process.stdout.write(t);
      },
      onTool: (name: string, phase: "start" | "done" | "denied", ms?: number) => {
        if (phase === "start") {
          toolCount++;
          process.stdout.write(`\n[tool ${name}] running...`);
        }
        else if (phase === "done") {
          process.stdout.write(` done ${ms}ms\n`);
          audit({ tool: name, args: lastArgs.get(name) ?? "", phase: "done", ms });
        }
        else {
          process.stdout.write(`\n[tool ${name}] denied\n`);
          audit({ tool: name, args: lastArgs.get(name) ?? "", phase: "denied" });
        }
      },
    }).then((out: string) => {
      clearTimeout(waiter);
      process.stdout.write("\n");
      if (toolCount >= 3 && cfg.autoSkill && !out.startsWith("(stopped")) {
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
        saveSkill(`auto-${stamp}`, `Task: ${input.slice(0, 300)}\nResult: ${out.slice(0, 1500)}`);
        console.log("(auto-skill saved)");
      }
      toolCount = 0;
      history = [...history.slice(-18), { role: "user", content: input }, { role: "assistant", content: out }];
      saveMemory(`Q: ${input.slice(0, 200)}\nA: ${out.slice(0, 400)}`, activeBot?.name ?? "");
      rl.prompt();
    }).catch((e: unknown) => {
      clearTimeout(waiter);
      console.log(`\nerror: ${e instanceof Error ? e.message : String(e)}`);
      rl.prompt();
    });
  });
}

async function cmdCronTick(cfg: HextraConfig): Promise<void> {
  wireTools(cfg.workspace);
  const policy = loadPolicy();
  const jobs = dueJobs();
  if (!jobs.length) {
    console.log("(no due jobs)");
    return;
  }
  for (const j of jobs) {
    console.log(`[cron ${j.id}] running: ${j.prompt.slice(0, 80)}`);
    try {
      const out = await runAgentLoop({
        cfg,
        system: buildSystemPrompt({ skills: loadSkills(), memory: recallMemory("project", 5) }),
        input: j.prompt,
        tools: listSchemas(),
        handlers: handlers(),
        approve: async (tool: string) => decide(policy, new Set(), tool) === "allow",
      });
      appendFileSync(join(dataDir(), "cron.log"), `[${new Date().toISOString()}] ${j.id} OK\n${out.slice(0, 2000)}\n---\n`);
      console.log(`[cron ${j.id}] done`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendFileSync(join(dataDir(), "cron.log"), `[${new Date().toISOString()}] ${j.id} ERROR ${msg}\n`);
      console.log(`[cron ${j.id}] error: ${msg}`);
    }
    markRun(j.id);
  }
}

async function cmdCron(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "list") {
    const jobs = loadJobs();
    if (!jobs.length) console.log("(no jobs)");
    for (const j of jobs) {
      const sched = j.everyMinutes ? `every ${j.everyMinutes}m` : `at ${j.at}`;
      console.log(`${j.id} [${sched}] last=${j.lastRun ?? "never"} :: ${j.prompt.slice(0, 100)}`);
    }
    return;
  }
  if (sub === "add") {
    const everyIdx = args.indexOf("--every");
    const atIdx = args.indexOf("--at");
    const dashIdx = args.indexOf("--");
    const prompt = dashIdx >= 0 ? args.slice(dashIdx + 1).join(" ") : args[args.length - 1] ?? "";
    if (!prompt || prompt.startsWith("--")) {
      console.log('usage: hextra cron add --every 60 -- "prompt" | --at 07:00 -- "prompt"');
      return;
    }
    const job = addJob(prompt, {
      everyMinutes: everyIdx >= 0 ? Number(args[everyIdx + 1]) : undefined,
      at: atIdx >= 0 ? args[atIdx + 1] : undefined,
    });
    console.log(`added ${job.id}`);
    return;
  }
  if (sub === "tick") {
    const cfg = loadConfig();
    if (!cfg) {
      console.log("No config. Run 'hextra setup' first.");
      return;
    }
    await cmdCronTick(cfg);
    return;
  }
  console.log("usage: hextra cron <add|list|tick>");
}

async function cmdBot(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "list" || !sub) {
    const bots = loadBots();
    if (!bots.length) console.log("(no bots)");
    for (const b of bots) {
      console.log(`${b.name}${b.model ? ` [${b.model}]` : ""}${b.system ? ` :: ${b.system.slice(0, 80)}` : ""}`);
    }
    return;
  }
  if (sub === "add") {
    const name = args[1] ?? "";
    const mi = args.indexOf("--model");
    const si = args.indexOf("--system");
    const bot = addBot(name, {
      model: mi >= 0 ? args[mi + 1] : undefined,
      system: si >= 0 ? args.slice(si + 1).join(" ") : undefined,
    });
    console.log(`added bot ${bot.name}`);
    return;
  }
  if (sub === "rm") {
    console.log(removeBot(args[1] ?? "") ? "removed" : "no such bot");
    return;
  }
  if (sub === "ask") {
    const cfg = loadConfig();
    if (!cfg) {
      console.log("No config. Run 'hextra setup' first.");
      return;
    }
    const bot = getBot(args[1] ?? "");
    if (!bot) {
      console.log("no such bot");
      return;
    }
    const prompt = args.slice(2).join(" ");
    if (!prompt) {
      console.log('usage: hextra bot ask <name> "prompt"');
      return;
    }
    wireTools(cfg.workspace);
    const profile = bot.model ? { ...cfg, model: bot.model } : cfg;
    const out = await runAgentLoop({
      cfg: profile,
      system: buildSystemPrompt({ identity: bot.system, skills: loadSkills(), memory: recallMemory("project", 5, bot.name) }),
      input: prompt,
      tools: listSchemas(),
      handlers: handlers(),
      approve: async (tool: string) => decide(loadPolicy(), new Set(), tool) === "allow",
    });
    console.log(out);
    saveMemory(`Q: ${prompt.slice(0, 200)}\nA: ${out.slice(0, 400)}`, bot.name);
    return;
  }
  console.log("usage: hextra bot <add|list|rm|ask>");
}

async function cmdUpdate(): Promise<void> {
  const res = await fetch("https://api.github.com/repos/Mercphobia/hextra/releases/latest", {
    headers: { "user-agent": "hextra" },
  });
  if (!res.ok) {
    console.log(`update check failed: ${res.status}`);
    return;
  }
  const rel = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
  const latest = rel.tag_name.replace(/^v/, "");
  if (latest === HEXTRA_VERSION) {
    console.log(`already latest (${HEXTRA_VERSION})`);
    return;
  }
  const plat = process.platform === "darwin"
    ? "darwin"
    : process.env.TERMUX_VERSION || existsSync("/data/data/com.termux")
      ? "android"
      : "linux";
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
  const asset = arch ? rel.assets.find((a) => a.name === `hextra-${plat}-${arch}.tar.gz`) : undefined;
  if (!asset) {
    console.log(`no binary for ${plat}-${arch} in ${rel.tag_name}; install from source`);
    return;
  }
  const runningSea = !process.execPath.endsWith("node") && !process.execPath.endsWith("node.exe");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const tmp = mkdtempSync(join(tmpdir(), "hextra-upd-"));
  const tgz = join(tmp, "hextra.tgz");
  console.log(`downloading ${asset.name} (${rel.tag_name})…`);
  const dl = await fetch(asset.browser_download_url, { headers: { "user-agent": "hextra" } });
  if (!dl.ok) {
    console.log(`download failed: ${dl.status}`);
    return;
  }
  writeFileSync(tgz, Buffer.from(await dl.arrayBuffer()));
  execFileSync("tar", ["-xzf", tgz, "-C", tmp]);
  const fresh = join(tmp, "hextra");
  if (!runningSea) {
    console.log(`downloaded to ${fresh} (source checkout running; replace manually)`);
    return;
  }
  renameSync(fresh, process.execPath);
  console.log(`updated to ${rel.tag_name}. Restart hextra.`);
}

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "chat";
if (cmd === "setup" || cmd === "--reset") void cmdSetup();
else if (cmd === "doctor") void cmdDoctor();
else if (cmd === "cron") void cmdCron(argv.slice(1));
else if (cmd === "bot") void cmdBot(argv.slice(1));
else if (cmd === "update") void cmdUpdate();
else if (cmd === "tui") {
  if (!process.stdin.isTTY) {
    console.log("hextra tui needs a TTY; use 'hextra' (readline) instead.");
  } else {
    void import("./ink.js").then((m) => m.runInkTui());
  }
} else if (cmd === "tui-native") {
  const onTermux = !!process.env.TERMUX_VERSION || existsSync("/data/data/com.termux");
  if (!onTermux) {
    console.log("tui-native is Termux-only (needs the Android native build). Use 'hextra tui' here.");
  } else if (!process.stdin.isTTY) {
    console.log("tui-native needs a TTY.");
  } else {
    void import("@hextra/tui-native/native.js").then((m) => m.runNativeTui()).catch((e: unknown) => {
      console.log(`native TUI failed: ${e instanceof Error ? e.message : String(e)}`);
      console.log("Falling back: use 'hextra' (readline) or 'hextra tui' (Ink).");
    });
  }
} else void cmdChat();
