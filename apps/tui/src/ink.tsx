import React, { useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp } from "ink";
import TextInput from "ink-text-input";
import { loadConfig, saveConfig, type HextraConfig } from "@hextra/core/config.js";
import { runAgentLoop, compressHistory } from "@hextra/core/agent-loop.js";
import { deleteSession, listSessions, loadSession, newSession, saveSession } from "@hextra/core/sessions.js";
import { getBot, loadBots, type BotProfile } from "@hextra/core/bots.js";
import { buildSystemPrompt } from "@hextra/core/prompt-builder.js";
import { handlers, listSchemas } from "@hextra/tools/registry.js";
import { connectMcpServers } from "@hextra/tools/mcp.js";
import { decide, loadPolicy, savePolicy, parseApprovalAnswer } from "@hextra/tools/permissions.js";
import { recallMemory, saveMemory } from "@hextra/memory/db.js";
import { listSkills, loadSkills, saveSkill } from "@hextra/memory/skills.js";
import { audit } from "@hextra/core/audit.js";
import { clampInput } from "@hextra/core/secrets.js";
import type { ChatMessage } from "@hextra/core/llm/openai-client.js";
import { wireTools, setAskHandler } from "@hextra/tools/wiring.js";
import { ApprovalBox, SlashHints, ToolBlock, Markdown, type TranscriptItem } from "./components.js";

function App({ cfg }: { cfg: HextraConfig }) {
  const { exit } = useApp();
  const [items, setItems] = useState<TranscriptItem[]>([
    { kind: "msg", who: "sys", text: "hextra tui — type / for commands. Risky tools ask approval inline." },
  ]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [status, setStatus] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ tool: string; args: string } | null>(null);
  const [activeBot, setActiveBot] = useState<BotProfile | null>(null);
  const [tokTotal, setTokTotal] = useState(0);
  const [askQ, setAskQ] = useState<{ question: string; options: string[] } | null>(null);
  const askRef = useRef<((text: string) => void) | null>(null);
  const history = useRef<ChatMessage[]>([]);
  const sessionRef = useRef(newSession(cfg.model));
  const draftRef = useRef("");
  const reasonRef = useRef("");
  const policy = useRef(loadPolicy());
  const grants = useRef(new Set<string>());
  const pendingRef = useRef<{ resolve: (ok: boolean) => void } | null>(null);
  const toolSeq = useRef(0);

  const push = (m: TranscriptItem) => setItems((prev) => [...prev.slice(-120), m]);

  useEffect(() => {
    setAskHandler(async (question: string, options: string[]) => {
      setAskQ({ question, options });
      return new Promise<string>((resolve) => {
        askRef.current = resolve;
      });
    });
  }, []);

  const submit = async (value: string) => {
    const input = value.trim();
    setQuery("");
    if (pendingRef.current) {
      const ans = parseApprovalAnswer(input);
      const p = pendingRef.current;
      pendingRef.current = null;
      const tool = pending?.tool ?? "?";
      if (ans === "always") {
        policy.current.allow.push(tool);
        savePolicy(policy.current);
      } else if (ans === "once") {
        grants.current.add(tool);
      }
      push({ kind: "msg", who: "sys", text: ans === "deny" ? `[denied] ${tool}` : `[allowed] ${tool}` });
      setPending(null);
      p.resolve(ans !== "deny");
      return;
    }
    if (askRef.current) {
      const resolve = askRef.current;
      askRef.current = null;
      setAskQ(null);
      const n = Number.parseInt(input, 10);
      const q = askQ;
      if (q && Number.isFinite(n) && n >= 1 && n <= q.options.length) resolve(q.options[n - 1]);
      else resolve(input || "no answer");
      return;
    }
    if (!input || busy) return;
    if (input === "/quit" || input === "/exit") {
      exit();
      return;
    }
    if (input === "/new") {
      history.current = [];
      grants.current.clear();
      sessionRef.current = newSession(cfg.model, activeBot?.name ?? undefined);
      setItems([]);
      setStatus("idle");
      return;
    }
    if (input === "/sessions") {
      const all = listSessions();
      push({ kind: "msg", who: "sys", text: all.map((s) => `${s.id} :: ${s.title}`).join("\n") || "(no sessions)" });
      return;
    }
    if (input.startsWith("/resume ")) {
      const hit = listSessions().find((s) => s.id.startsWith(input.slice(8).trim()));
      const loaded = hit ? loadSession(hit.id) : null;
      if (!loaded) {
        push({ kind: "msg", who: "sys", text: "no such session" });
        return;
      }
      sessionRef.current = loaded;
      history.current = loaded.history;
      push({ kind: "msg", who: "sys", text: `resumed ${loaded.id} :: ${loaded.title}` });
      return;
    }
    if (input.startsWith("/rm ")) {
      push({ kind: "msg", who: "sys", text: deleteSession(input.slice(4).trim()) ? "removed" : "no such session" });
      return;
    }
    if (input === "/help") {
      push({ kind: "msg", who: "sys", text: "/new /sessions /resume /rm /model <name> /skills /usage /undo /compress /bot <name> /help /quit" });
      return;
    }
    if (input === "/skills") {
      push({ kind: "msg", who: "sys", text: listSkills().join("\n") || "(no skills)" });
      return;
    }
    if (input === "/usage") {
      const chars = history.current.reduce((n, m) => n + m.content.length, 0);
      push({ kind: "msg", who: "sys", text: `~${Math.round(chars / 4)} tokens in session history` });
      return;
    }
    if (input === "/undo") {
      history.current = history.current.slice(0, -2);
      sessionRef.current.history = history.current;
      saveSession(sessionRef.current);
      push({ kind: "msg", who: "sys", text: "(last turn dropped)" });
      return;
    }
    if (input === "/compress") {
      const turnCfg = activeBot?.model ? { ...cfg, model: activeBot.model } : cfg;
      setStatus("compressing…");
      try {
        history.current = await compressHistory(turnCfg, history.current);
        sessionRef.current.history = history.current;
        saveSession(sessionRef.current);
        push({ kind: "msg", who: "sys", text: "(session compressed)" });
      } catch (e) {
        push({ kind: "msg", who: "sys", text: `compress failed: ${e instanceof Error ? e.message : String(e)}` });
      }
      setStatus("idle");
      return;
    }
    if (input.startsWith("/model ")) {
      cfg.model = input.slice(7).trim();
      saveConfig(cfg);
      push({ kind: "msg", who: "sys", text: `model -> ${cfg.model}` });
      return;
    }
    if (input === "/bot" || input.startsWith("/bot ")) {
      const name = input.slice(4).trim();
      if (!name) {
        push({ kind: "msg", who: "sys", text: loadBots().map((b) => b.name).join(" ") || "(no bots)" });
        return;
      }
      const bot = getBot(name);
      if (!bot) {
        push({ kind: "msg", who: "sys", text: `no bot '${name}'` });
        return;
      }
      setActiveBot(bot);
      history.current = [];
      sessionRef.current = newSession(cfg.model, bot.name);
      push({ kind: "msg", who: "sys", text: `bot -> ${bot.name}` });
      return;
    }
    if (input.startsWith("/")) {
      push({ kind: "msg", who: "sys", text: `unknown command: ${input}` });
      return;
    }
    const { text: clamped, truncated } = clampInput(input);
    if (truncated) push({ kind: "msg", who: "sys", text: "(input clamped to 20000 chars)" });
    push({ kind: "msg", who: "you", text: clamped });
    setBusy(true);
    setStatus("thinking…");
    draftRef.current = "";
    reasonRef.current = "";
    setReasoning("");
    setDraft("");
    let toolsUsed = 0;
    const turnCfg = activeBot?.model ? { ...cfg, model: activeBot.model } : cfg;
    const ns = activeBot?.name ?? "";
    try {
      const out = await runAgentLoop({
        cfg: turnCfg,
        system: buildSystemPrompt({ identity: activeBot?.system, skills: loadSkills(), memory: recallMemory("project", 5, ns) }),
        input: clamped,
        history: history.current,
        tools: listSchemas(),
        handlers: handlers(),
        approve: async (tool: string, args: string) => {
          const d = decide(policy.current, grants.current, tool);
          if (d === "deny") {
            audit({ tool, args, phase: "denied" });
            return false;
          }
          if (d === "allow") return true;
          setStatus("waiting approval…");
          setPending({ tool, args });
          return new Promise<boolean>((resolve) => {
            pendingRef.current = { resolve };
          });
        },
        onToken: (t: string) => {
          draftRef.current += t;
          setDraft(draftRef.current.slice(-2000));
        },
        onReasoning: (t: string) => {
          reasonRef.current += t;
          setReasoning(reasonRef.current.slice(-1000));
        },
        onTool: (name: string, phase: "start" | "done" | "denied", ms?: number, detail?: { id: string; args: string; result?: string }) => {
          if (phase === "start") {
            toolsUsed++;
            push({ kind: "tool", id: toolSeq.current++, callId: detail?.id ?? "", name, args: detail?.args ?? "", status: "running" });
            setStatus(`[tool ${name}] running…`);
          } else {
            setItems((prev) => prev.map((it) => it.kind === "tool" && detail && it.callId === detail.id && it.status === "running"
              ? { ...it, status: phase === "done" ? "done" : "denied", ms, result: detail.result }
              : it));
            setStatus(phase === "done" ? `[tool ${name}] done ${ms}ms` : `[tool ${name}] denied`);
          }
        },
      });
      push({ kind: "msg", who: "ai", text: out });
      setDraft("");
      setReasoning("");
      setTokTotal((n) => n + Math.round((clamped.length + out.length) / 4));
      history.current = [...history.current.slice(-18), { role: "user", content: clamped }, { role: "assistant", content: out }];
      sessionRef.current.history = history.current;
      sessionRef.current.model = cfg.model;
      saveSession(sessionRef.current);
      saveMemory(`Q: ${clamped.slice(0, 200)}\nA: ${out.slice(0, 400)}`, ns);
      if (toolsUsed >= 3 && cfg.autoSkill && !out.startsWith("(stopped")) {
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
        saveSkill(`auto-${stamp}`, `Task: ${clamped.slice(0, 300)}\nResult: ${out.slice(0, 1500)}`);
        push({ kind: "msg", who: "sys", text: "(auto-skill saved)" });
      }
      setStatus("idle");
    } catch (e) {
      push({ kind: "msg", who: "sys", text: `error: ${e instanceof Error ? e.message : String(e)}` });
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">hextra</Text>
        <Text> {activeBot ? `${activeBot.name}@` : ""}{cfg.model} · {status}</Text>
      </Box>
      <Box flexDirection="column" marginY={1}>
        {items.map((m, i) => m.kind === "tool" ? (
          <ToolBlock key={`t${m.id}`} item={m} />
        ) : m.who === "ai" ? (
          <Box key={i} flexDirection="column"><Text>◆ </Text><Markdown text={m.text} /></Box>
        ) : (
          <Text key={i} color={m.who === "you" ? "green" : "gray"}>
            {m.who === "you" ? "> " : "· "}{m.text}
          </Text>
        ))}
        {reasoning ? <Box flexDirection="column"><Text dimColor>∴ {reasoning}</Text></Box> : null}
        {draft ? <Box flexDirection="column"><Text>◆ </Text><Markdown text={draft} /></Box> : null}
      </Box>
      {pending ? <ApprovalBox tool={pending.tool} args={pending.args} /> : null}
      {askQ ? (
        <Box borderStyle="double" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold color="cyan">? {askQ.question}</Text>
          {askQ.options.map((o, i) => <Text key={i} dimColor>{i + 1}. {o}</Text>)}
          <Text dimColor>number or your own answer</Text>
        </Box>
      ) : null}
      <SlashHints query={query} />
      <Box borderStyle="single" paddingX={1}>
        <Text color="green">› </Text>
        <TextInput value={query} onChange={setQuery} onSubmit={(v) => void submit(v)} focus={!busy || pending !== null} />
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{cfg.model} · {listSchemas().length} tools · ~{(tokTotal / 1000).toFixed(1)}k · {status}{pending ? ` · APPROVAL ${pending.tool} (a/w/d)` : ""}</Text>
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
