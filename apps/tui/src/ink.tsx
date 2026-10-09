import React, { useRef, useState } from "react";
import { Box, Text, render, useApp } from "ink";
import TextInput from "ink-text-input";
import { loadConfig, type HextraConfig } from "@hextra/core/config.js";
import { runAgentLoop } from "@hextra/core/agent-loop.js";
import { buildSystemPrompt } from "@hextra/core/prompt-builder.js";
import { handlers, listSchemas } from "@hextra/tools/registry.js";
import { connectMcpServers } from "@hextra/tools/mcp.js";
import { decide, loadPolicy, savePolicy, parseApprovalAnswer } from "@hextra/tools/permissions.js";
import { recallMemory, saveMemory } from "@hextra/memory/db.js";
import { loadSkills, saveSkill } from "@hextra/memory/skills.js";
import { audit } from "@hextra/core/audit.js";
import { clampInput, redactSecrets } from "@hextra/core/secrets.js";
import type { ChatMessage } from "@hextra/core/llm/openai-client.js";
import { wireTools } from "@hextra/tools/wiring.js";

interface Msg {
  who: "you" | "ai" | "sys";
  text: string;
}

function App({ cfg }: { cfg: HextraConfig }) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Msg[]>([
    { who: "sys", text: "hextra tui — /help /new /quit. Risky tools ask approval inline." },
  ]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [pendingTool, setPendingTool] = useState<string | null>(null);
  const history = useRef<ChatMessage[]>([]);
  const draftRef = useRef("");
  const policy = useRef(loadPolicy());
  const pendingRef = useRef<{ tool: string; resolve: (ok: boolean) => void } | null>(null);

  const push = (m: Msg) => setMessages((prev) => [...prev.slice(-100), m]);

  const submit = async (value: string) => {
    const input = value.trim();
    setQuery("");
    if (pendingRef.current) {
      const ans = parseApprovalAnswer(input);
      const p = pendingRef.current;
      pendingRef.current = null;
      setPendingTool(null);
      if (ans === "always") {
        policy.current.allow.push(p.tool);
        savePolicy(policy.current);
      }
      push({ who: "sys", text: ans === "deny" ? `[denied] ${p.tool}` : `[allowed] ${p.tool}` });
      p.resolve(ans !== "deny");
      return;
    }
    if (!input || busy) return;
    if (input === "/quit" || input === "/exit") {
      exit();
      return;
    }
    if (input === "/new") {
      history.current = [];
      setMessages([]);
      setStatus("idle");
      return;
    }
    if (input === "/help") {
      push({ who: "sys", text: "/new fresh session · /quit exit · approvals happen in readline chat" });
      return;
    }
    if (input.startsWith("/")) {
      push({ who: "sys", text: `unknown command in tui (use readline chat): ${input}` });
      return;
    }
    const { text: clamped, truncated } = clampInput(input);
    if (truncated) push({ who: "sys", text: "(input clamped to 20000 chars)" });
    push({ who: "you", text: clamped });
    setBusy(true);
    setStatus("thinking…");
    draftRef.current = "";
    setDraft("");
    let toolsUsed = 0;
    try {
      const out = await runAgentLoop({
        cfg,
        system: buildSystemPrompt({ skills: loadSkills(), memory: recallMemory("project", 5) }),
        input: clamped,
        history: history.current,
        tools: listSchemas(),
        handlers: handlers(),
        approve: async (tool: string, args: string) => {
          const d = decide(policy.current, new Set(), tool);
          if (d === "deny") {
            audit({ tool, args, phase: "denied" });
            return false;
          }
          if (d === "allow") return true;
          push({ who: "sys", text: `[permission] ${tool} ${redactSecrets(args).slice(0, 100)} — answer (a)lways/(a)llow/(d)eny:` });
          setStatus("waiting approval…");
          setPendingTool(tool);
          return new Promise<boolean>((resolve) => {
            pendingRef.current = { tool, resolve };
          });
        },
        onToken: (t: string) => {
          draftRef.current += t;
          setDraft(draftRef.current.slice(-2000));
        },
        onTool: (name: string, phase: "start" | "done" | "denied", ms?: number) => {
          if (phase === "start") {
            toolsUsed++;
            setStatus(`[tool ${name}] running…`);
          } else if (phase === "done") {
            setStatus(`[tool ${name}] done ${ms}ms`);
          } else {
            setStatus(`[tool ${name}] denied`);
          }
        },
      });
      push({ who: "ai", text: out });
      setDraft("");
      history.current = [...history.current.slice(-18), { role: "user", content: clamped }, { role: "assistant", content: out }];
      saveMemory(`Q: ${clamped.slice(0, 200)}\nA: ${out.slice(0, 400)}`);
      if (toolsUsed >= 3 && cfg.autoSkill && !out.startsWith("(stopped")) {
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
        saveSkill(`auto-${stamp}`, `Task: ${clamped.slice(0, 300)}\nResult: ${out.slice(0, 1500)}`);
        push({ who: "sys", text: "(auto-skill saved)" });
      }
      setStatus("idle");
    } catch (e) {
      push({ who: "sys", text: `error: ${e instanceof Error ? e.message : String(e)}` });
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">hextra</Text>
        <Text> {cfg.model} · {listSchemas().length} tools · {status}</Text>
      </Box>
      <Box flexDirection="column" marginY={1}>
        {messages.map((m, i) => (
          <Text key={i} color={m.who === "you" ? "green" : m.who === "ai" ? "white" : "gray"}>
            {m.who === "you" ? "> " : m.who === "ai" ? "◆ " : "· "}{m.text}
          </Text>
        ))}
        {draft ? <Text color="white">◆ {draft}</Text> : null}
      </Box>
      <Box borderStyle="single" paddingX={1}>
        <Text color="green">› </Text>
        <TextInput value={query} onChange={setQuery} onSubmit={(v) => void submit(v)} focus={!busy || pendingTool !== null} />
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{cfg.model} · {listSchemas().length} tools · {status}{pendingTool ? ` · APPROVAL ${pendingTool} (a/w/d)` : ""}</Text>
      </Box>
    </Box>
  );
}

export async function runInkTui(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) {
    console.log("No config. Run 'hextra setup' first.");
    return;
  }
  wireTools(cfg.workspace);
  const mcp = await connectMcpServers(cfg.mcpServers ?? []);
  for (const w of mcp.warnings) console.log(`mcp warn: ${w}`);
  const { registerTool } = await import("@hextra/tools/registry.js");
  for (const s of mcp.schemas) {
    registerTool(s.function.name, s.function.description, s.function.parameters, mcp.handlers[s.function.name]);
  }
  const { waitUntilExit } = render(<App cfg={cfg} />);
  await waitUntilExit();
  mcp.clients.forEach((c) => c.stop());
}
