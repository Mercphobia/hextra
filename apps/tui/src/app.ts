#!/usr/bin/env node
import { createInterface } from "node:readline";
import {
  loadConfig, saveConfig, defaultWorkspace, DEFAULT_BASE_URL, type HextraConfig,
} from "@hextra/core/config.js";
import { testConnection, type ChatMessage } from "@hextra/core/llm/openai-client.js";
import { runAgentLoop } from "@hextra/core/agent-loop.js";
import { addJob, dueJobs, loadJobs, markRun } from "@hextra/core/cron.js";
import { buildSystemPrompt } from "@hextra/core/prompt-builder.js";
import { registerTool, listSchemas, handlers } from "@hextra/tools/registry.js";
import { readFile, grepFiles } from "@hextra/tools/fs.js";
import { globFiles } from "@hextra/tools/glob.js";
import { connectMcpServers } from "@hextra/tools/mcp.js";
import { editFile } from "@hextra/tools/patch.js";
import { decide, loadPolicy, savePolicy } from "@hextra/tools/permissions.js";
import { runShell } from "@hextra/tools/shell.js";
import { webfetch } from "@hextra/tools/web.js";
import { writeFile } from "@hextra/tools/write.js";
import { recallMemory, saveMemory } from "@hextra/memory/db.js";
import { listSkills, loadSkills, saveSkill } from "@hextra/memory/skills.js";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@hextra/core/config.js";

function arg<T>(json: string, key: string): T {
  return (JSON.parse(json) as Record<string, T>)[key];
}

function wireTools(workspace: string): void {
  registerTool("read_file", "Read a file inside workspace", { type: "object", properties: { path: { type: "string" } } },
    async (a) => readFile(workspace, arg<string>(a, "path")));
  registerTool("write_file", "Write a file inside workspace (asks approval)", { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
    async (a) => writeFile(workspace, arg<string>(a, "path"), arg<string>(a, "content")));
  registerTool("edit_file", "Replace one exact block in a file (asks approval)", { type: "object", properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" } } },
    async (a) => editFile(workspace, arg<string>(a, "path"), arg<string>(a, "search"), arg<string>(a, "replace")));
  registerTool("glob", "List files matching a * pattern", { type: "object", properties: { pattern: { type: "string" } } },
    async (a) => globFiles(workspace, arg<string>(a, "pattern")).join("\n") || "(no matches)");
  registerTool("shell", "Run an allowlisted shell command in workspace (asks approval)", { type: "object", properties: { command: { type: "string" } } },
    async (a) => runShell(workspace, arg<string>(a, "command")));
  registerTool("grep", "Search file contents in workspace", { type: "object", properties: { pattern: { type: "string" } } },
    async (a) => grepFiles(workspace, arg<string>(a, "pattern")).join("\n") || "(no matches)");
  registerTool("webfetch", "Fetch a URL as text", { type: "object", properties: { url: { type: "string" } } },
    async (a) => webfetch(arg<string>(a, "url")));
  registerTool("memory_save", "Save a fact to long-term memory", { type: "object", properties: { text: { type: "string" } } },
    async (a) => { saveMemory(arg<string>(a, "text")); return "saved"; });
  registerTool("memory_recall", "Recall facts from long-term memory", { type: "object", properties: { query: { type: "string" } } },
    async (a) => recallMemory(arg<string>(a, "query")) || "(nothing recalled)");
  registerTool("skill_save", "Save a reusable skill note", { type: "object", properties: { name: { type: "string" }, body: { type: "string" } } },
    async (a) => { saveSkill(arg<string>(a, "name"), arg<string>(a, "body")); return "skill saved"; });
}

function ask(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a: string) => resolve(a.trim())));
}

async function cmdSetup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("hextra setup — 9 steps (resumable). Hermes logic, OpenCode-style prompts.");
  const baseUrl = (await ask(rl, `BaseURL [${DEFAULT_BASE_URL}]: `)) || DEFAULT_BASE_URL;
  const apiKey = await ask(rl, "API key: ");
  const model = (await ask(rl, "Model [nous-hermes-2-mistral-7b]: ")) || "nous-hermes-2-mistral-7b";
  if (!apiKey) {
    console.log("API key required for cloud primary. Aborted.");
    rl.close();
    return;
  }
  const t = await testConnection({ baseUrl, apiKey, model });
  console.log(`connection test: ${t.ok ? "OK" : "FAIL"} — ${t.detail}`);
  const fallbackBaseUrl = await ask(rl, "Fallback baseURL [skip]: ");
  const workspace = (await ask(rl, `Workspace [${defaultWorkspace()}]: `)) || defaultWorkspace();
  const cfg: HextraConfig = {
    baseUrl, apiKey, model,
    fallbackBaseUrl: fallbackBaseUrl || undefined,
    fallbackModel: fallbackBaseUrl ? "qwen3:4b" : undefined,
    workspace, theme: "dark", autoSkill: true,
  };
  saveConfig(cfg);
  console.log("saved to ~/.config/hextra/config.json (0600). Run 'hextra' to chat.");
  rl.close();
}

async function cmdDoctor(): Promise<void> {
  console.log(`node: ${process.version} arch: ${process.arch} platform: ${process.platform}`);
  console.log(`config: ${loadConfig() ? "found" : "missing — run 'hextra setup'"}`);
  console.log(`TERMUX_VERSION: ${process.env.TERMUX_VERSION ?? "(not termux)"}`);
}

const HELP = [
  "/new — fresh session",
  "/model <name> — switch cloud model",
  "/skills — list saved skills",
  "/usage — rough token estimate of this session",
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
  const system = () => buildSystemPrompt({ skills: loadSkills(), memory: recallMemory("project", 5) });
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "hextra> " });

  const approve = async (tool: string, args: string): Promise<boolean> => {
    const d = decide(policy, sessionGrants, tool);
    if (d === "allow") return true;
    if (d === "deny") {
      console.log(`\n[deny] ${tool} blocked by policy`);
      return false;
    }
    const ans = await ask(rl, `\n[permission] ${tool} ${args.slice(0, 120)} — (a)llow once / al(w)ays / (d)eny: `);
    if (ans === "w") {
      policy.allow.push(tool);
      savePolicy(policy);
      return true;
    }
    if (ans === "a" || ans === "y") {
      sessionGrants.add(tool);
      return true;
    }
    return false;
  };

  console.log("10 tools ready. /help for commands.");
  rl.on("close", () => mcp.clients.forEach((c) => c.stop()));
  rl.prompt();
  rl.on("line", (line: string) => {
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
    if (input.startsWith("/model ")) {
      cfg.model = input.slice(7).trim();
      saveConfig(cfg);
      console.log(`model -> ${cfg.model}`);
      return rl.prompt();
    }
    if (input === "/setup") {
      rl.close();
      void cmdSetup();
      return;
    }
    toolCount = 0;
    void runAgentLoop({
      cfg, system: system(), input, history, tools: listSchemas(), handlers: handlers(), approve,
      onToken: (t: string) => process.stdout.write(t),
      onTool: (name: string, phase: "start" | "done" | "denied", ms?: number) => {
        if (phase === "start") {
          toolCount++;
          process.stdout.write(`\n[tool ${name}] running...`);
        }
        else if (phase === "done") process.stdout.write(` done ${ms}ms\n`);
        else process.stdout.write(`\n[tool ${name}] denied\n`);
      },
    }).then((out: string) => {
      process.stdout.write("\n");
      if (toolCount >= 3 && cfg.autoSkill && !out.startsWith("(stopped")) {
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
        saveSkill(`auto-${stamp}`, `Task: ${input.slice(0, 300)}\nResult: ${out.slice(0, 1500)}`);
        console.log("(auto-skill saved)");
      }
      toolCount = 0;
      history = [...history.slice(-18), { role: "user", content: input }, { role: "assistant", content: out }];
      saveMemory(`Q: ${input.slice(0, 200)}\nA: ${out.slice(0, 400)}`);
      rl.prompt();
    }).catch((e: unknown) => {
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

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "chat";
if (cmd === "setup" || cmd === "--reset") void cmdSetup();
else if (cmd === "doctor") void cmdDoctor();
else if (cmd === "cron") void cmdCron(argv.slice(1));
else void cmdChat();
