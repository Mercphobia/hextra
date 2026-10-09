#!/usr/bin/env node
import { createInterface } from "node:readline";
import { loadConfig, saveConfig, defaultWorkspace, DEFAULT_BASE_URL, type HextraConfig } from "@hextra/core/config.js";
import { testConnection } from "@hextra/core/llm/openai-client.js";
import { runAgentLoop } from "@hextra/core/agent-loop.js";
import { buildSystemPrompt } from "@hextra/core/prompt-builder.js";
import { registerTool, listSchemas, handlers } from "@hextra/tools/registry.js";
import { readFile, grepFiles } from "@hextra/tools/fs.js";
import { runShell } from "@hextra/tools/shell.js";
import { webfetch } from "@hextra/tools/web.js";
import { recallMemory, saveMemory } from "@hextra/memory/db.js";
import { loadSkills } from "@hextra/memory/skills.js";

function ask(rl: ReturnType<typeof createInterface>, q: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    if (!hidden) {
      rl.question(q, (a: string) => resolve(a.trim()));
      return;
    }
    const stdin = process.stdin;
    const onData = (c: Buffer) => {
      if (c.toString() === "\n" || c.toString() === "\r\n") {
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve((rl as unknown as { line: string }).line?.trim() ?? "");
      }
    };
    stdin.on("data", onData);
    rl.question(q, () => {});
  });
}

function wireTools(workspace: string): void {
  registerTool("read_file", "Read a file inside workspace", { type: "object", properties: { path: { type: "string" } } },
    async (a) => readFile(workspace, (JSON.parse(a) as { path: string }).path));
  registerTool("shell", "Run an allowlisted shell command in workspace", { type: "object", properties: { command: { type: "string" } } },
    async (a) => runShell(workspace, (JSON.parse(a) as { command: string }).command));
  registerTool("grep", "Search files in workspace", { type: "object", properties: { pattern: { type: "string" } } },
    async (a) => grepFiles(workspace, (JSON.parse(a) as { pattern: string }).pattern).join("\n"));
  registerTool("webfetch", "Fetch a URL as text", { type: "object", properties: { url: { type: "string" } } },
    async (a) => webfetch((JSON.parse(a) as { url: string }).url));
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
  console.log(`saved to ~/.config/hextra/config.json (0600). Run 'hextra' to chat.`);
  rl.close();
}

async function cmdDoctor(): Promise<void> {
  console.log(`node: ${process.version} arch: ${process.arch} platform: ${process.platform}`);
  console.log(`config: ${loadConfig() ? "found" : "missing — run 'hextra setup'"}`);
  console.log(`TERMUX_VERSION: ${process.env.TERMUX_VERSION ?? "(not termux)"}`);
}

async function cmdChat(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) {
    console.log("No config. Run 'hextra setup' first.");
    return;
  }
  wireTools(cfg.workspace);
  const system = buildSystemPrompt({ skills: loadSkills(), memory: recallMemory("project", 5) });
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "hextra> " });
  rl.prompt();
  rl.on("line", (line) => {
    const input = line.trim();
    if (!input) return rl.prompt();
    if (input === "/quit" || input === "/exit") return rl.close();
    if (input === "/setup") {
      rl.close();
      void cmdSetup();
      return;
    }
    void runAgentLoop({
      cfg, system, input, tools: listSchemas(), handlers: handlers(),
      onToken: (t: string) => process.stdout.write(t),
    }).then((out: string) => {
      if (!out.startsWith(process.argv[0])) process.stdout.write("\n");
      saveMemory(`Q: ${input.slice(0, 200)}\nA: ${out.slice(0, 400)}`);
      rl.prompt();
    }).catch((e: unknown) => {
      console.log(`\nerror: ${e instanceof Error ? e.message : String(e)}`);
      rl.prompt();
    });
  });
}

const cmd = process.argv[2] ?? "chat";
if (cmd === "setup" || cmd === "--reset") void cmdSetup();
else if (cmd === "doctor") void cmdDoctor();
else void cmdChat();
