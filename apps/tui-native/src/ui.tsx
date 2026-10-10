/** @jsxImportSource @androidtui/react */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, useKeyboard } from "@androidtui/react";
import type { SyntaxStyle } from "@androidtui/core";
import { loadConfig, saveConfig, type HextraConfig } from "@hextra/core/config.js";
import { runAgentLoop, compressHistory } from "@hextra/core/agent-loop.js";
import { getBot, loadBots, type BotProfile } from "@hextra/core/bots.js";
import { buildSystemPrompt } from "@hextra/core/prompt-builder.js";
import { handlers, listSchemas } from "@hextra/tools/registry.js";
import { connectMcpServers } from "@hextra/tools/mcp.js";
import { decide, loadPolicy, savePolicy, parseApprovalAnswer } from "@hextra/tools/permissions.js";
import { recallMemory, saveMemory } from "@hextra/memory/db.js";
import { listSkills, loadSkills, saveSkill } from "@hextra/memory/skills.js";
import { audit } from "@hextra/core/audit.js";
import { clampInput, redactSecrets } from "@hextra/core/secrets.js";
import { renderDiff } from "@hextra/tools/diff.js";
import { listModels } from "@hextra/core/llm/openai-client.js";
import type { ChatMessage } from "@hextra/core/llm/openai-client.js";
import { wireTools } from "@hextra/tools/wiring.js";
import { setAskHandler } from "@hextra/tools/ask.js";
import { execFileSync } from "node:child_process";

export type TItem =
  | { kind: "msg"; who: "you" | "ai" | "sys"; text: string }
  | { kind: "tool"; id: number; callId: string; name: string; args: string; status: "running" | "done" | "denied"; ms?: number; result?: string };

const SLASH = ["/new", "/model", "/models", "/skills", "/usage", "/undo", "/compress", "/expand", "/bot", "/help", "/quit"];

function argSummary(name: string, args: string): string {
  try {
    const o = JSON.parse(args) as Record<string, unknown>;
    return String(o.path ?? o.command ?? o.pattern ?? o.url ?? o.query ?? "").slice(0, 60);
  } catch {
    return "";
  }
}

function DiffView({ name, args }: { name: string; args: string }) {
  if (name !== "edit_file") return null;
  try {
    const o = JSON.parse(args) as { search?: string; replace?: string };
    if (!o.search || o.replace === undefined) return null;
    return (
      <>
        {renderDiff(o.search, o.replace, 8).map((l, i) => (
          <text key={i} fg={l.startsWith("+") ? "green" : l.startsWith("-") ? "red" : "gray"}>{l}</text>
        ))}
      </>
    );
  } catch {
    return null;
  }
}

function ToolView({ item }: { item: Extract<TItem, { kind: "tool" }> }) {
  const color = item.status === "done" ? "green" : item.status === "denied" ? "red" : "yellow";
  const tail = item.status === "running" ? "…" : item.status === "denied" ? "denied" : `${item.ms}ms`;
  return (
    <box flexDirection="column" paddingLeft={1}>
      <text fg={color}>◈ {item.name} {argSummary(item.name, item.args)} · {tail}</text>
      <DiffView name={item.name} args={item.args} />
      {item.status === "done" && item.result ? (
        <text fg="gray">{redactSecrets(item.result).split("\n").slice(0, 6).join("\n").slice(0, 600)}</text>
      ) : null}
    </box>
  );
}

function AiMessage({ text, style }: { text: string; style: SyntaxStyle | null }) {
  if (style) return <markdown content={text} syntaxStyle={style} />;
  return <text>{text}</text>;
}

function App({ cfg, style, onExit }: { cfg: HextraConfig; style: SyntaxStyle | null; onExit: () => void }) {
  const [items, setItems] = useState<TItem[]>([
    { kind: "msg", who: "sys", text: "hextra native — type / for commands." },
  ]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ tool: string; args: string } | null>(null);
  const [askQ, setAskQ] = useState<{ question: string; options: string[] } | null>(null);
  const askRef = useRef<((text: string) => void) | null>(null);
  const [picker, setPicker] = useState<{ options: { name: string; description: string }[] } | null>(null);
  const [activeBot, setActiveBot] = useState<BotProfile | null>(null);
  const [tokTotal, setTokTotal] = useState(0);
  const history = useRef<ChatMessage[]>([]);
  const draftRef = useRef("");
  const policy = useRef(loadPolicy());
  const grants = useRef(new Set<string>());
  const approveRef = useRef<((ok: boolean) => void) | null>(null);
  const pickRef = useRef<((index: number) => void) | null>(null);
  const toolSeq = useRef(0);
  const lastTools = useRef<{ name: string; result: string }[]>([]);
  const branch = useMemo(() => {
    try {
      return execFileSync("git", ["-C", cfg.workspace, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  }, [cfg.workspace]);
  const cwdName = useMemo(() => cfg.workspace.split("/").filter(Boolean).pop() ?? "~", [cfg.workspace]);

  useKeyboard((k) => {
    if (k.name === "escape" && picker) {
      pickRef.current?.(-1);
      pickRef.current = null;
      setPicker(null);
    }
  });

  const push = (m: TItem) => setItems((prev) => [...prev.slice(-120), m]);

  useEffect(() => {
    setAskHandler(async (question: string, options: string[]) => {
      setAskQ({ question, options });
      return new Promise<string>((resolve) => {
        askRef.current = resolve;
      });
    });
  }, []);

  const askInline = (question: string): Promise<string> => {
    push({ kind: "msg", who: "sys", text: question });
    return new Promise<string>((resolve) => {
      askRef.current = resolve;
    });
  };

  const submit = async (value: string) => {
    const input = value.trim();
    setQuery("");
    if (approveRef.current) {
      const ans = parseApprovalAnswer(input);
      const resolve = approveRef.current;
      approveRef.current = null;
      const tool = pending?.tool ?? "?";
      if (ans === "always") {
        policy.current.allow.push(tool);
        savePolicy(policy.current);
      } else if (ans === "once") {
        grants.current.add(tool);
      }
      push({ kind: "msg", who: "sys", text: ans === "deny" ? `[denied] ${tool}` : `[allowed] ${tool}` });
      setPending(null);
      resolve(ans !== "deny");
      return;
    }
    if (askRef.current) {
      const resolve = askRef.current;
      askRef.current = null;
      resolve(input);
      return;
    }
    if (!input || busy || picker) return;
    if (input === "/quit" || input === "/exit") {
      onExit();
      return;
    }
    if (input === "/new") {
      history.current = [];
      grants.current.clear();
      setItems([]);
      setStatus("idle");
      return;
    }
    if (input === "/help") {
      push({ kind: "msg", who: "sys", text: "/new /model <name> /models /skills /usage /undo /compress /expand /bot <name> /help /quit" });
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
      push({ kind: "msg", who: "sys", text: "(last turn dropped)" });
      return;
    }
    if (input === "/compress") {
      const turnCfg = activeBot?.model ? { ...cfg, model: activeBot.model } : cfg;
      setStatus("compressing…");
      try {
        history.current = await compressHistory(turnCfg, history.current);
        push({ kind: "msg", who: "sys", text: "(session compressed)" });
      } catch (e) {
        push({ kind: "msg", who: "sys", text: `compress failed: ${e instanceof Error ? e.message : String(e)}` });
      }
      setStatus("idle");
      return;
    }
    if (input === "/expand") {
      if (!lastTools.current.length) push({ kind: "msg", who: "sys", text: "(no tool output yet)" });
      else for (const t of lastTools.current.slice(-3)) {
        push({ kind: "msg", who: "sys", text: `━━ ${t.name} ━━\n${t.result.slice(0, 3000)}` });
      }
      return;
    }
    if (input.startsWith("/model ")) {
      cfg.model = input.slice(7).trim();
      saveConfig(cfg);
      push({ kind: "msg", who: "sys", text: `model -> ${cfg.model}` });
      return;
    }
    if (input === "/models") {
      setStatus("fetching models…");
      try {
        const models = await listModels({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model });
        if (!models.length) {
          push({ kind: "msg", who: "sys", text: "(no models listed)" });
          setStatus("idle");
          return;
        }
        const idx = await new Promise<number>((resolve) => {
          pickRef.current = resolve;
          setPicker({ options: models.map((m) => ({ name: m, description: m === cfg.model ? "current" : "" })) });
        });
        setPicker(null);
        if (idx >= 0 && idx < models.length) {
          cfg.model = models[idx];
          saveConfig(cfg);
          push({ kind: "msg", who: "sys", text: `model -> ${cfg.model}` });
        }
      } catch (e) {
        push({ kind: "msg", who: "sys", text: `models failed: ${e instanceof Error ? e.message : String(e)}` });
      }
      setStatus("idle");
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
            approveRef.current = resolve;
          });
        },
        onToken: (t: string) => {
          draftRef.current += t;
          setDraft(draftRef.current.slice(-2000));
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
            if (phase === "done") {
              lastTools.current.push({ name, result: detail?.result ?? "" });
              lastTools.current = lastTools.current.slice(-10);
            }
            setStatus(phase === "done" ? `[tool ${name}] done ${ms}ms` : `[tool ${name}] denied`);
          }
        },
      });
      push({ kind: "msg", who: "ai", text: out });
      setDraft("");
      history.current = [...history.current.slice(-18), { role: "user", content: clamped }, { role: "assistant", content: out }];
      setTokTotal((n) => n + Math.round((clamped.length + out.length) / 4));
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

  const hintHits = query.startsWith("/") ? SLASH.filter((c) => c.startsWith(query)).slice(0, 6) : [];

  return (
    <box flexDirection="column" padding={1}>
      <text fg="gray">{cwdName}{branch ? ` ⎇${branch}` : ""} · {activeBot ? `${activeBot.name}@` : ""}{cfg.model} · {status}</text>
      <scrollbox stickyScroll stickyStart="bottom">
        {items.map((m, i) => {
          const prev = items[i - 1];
          const grouped = prev && prev.kind === "tool" && m.kind === "tool" && (prev as { callId: string }).callId === (m as { callId: string }).callId;
          return (<React.Fragment key={m.kind === "tool" ? `t${m.id}` : `m${i}`}>
            {!grouped && i > 0 ? <text> </text> : null}
            {m.kind === "tool" ? (
              <ToolView item={m} />
            ) : m.who === "ai" ? (
              <box flexDirection="column"><text>◆ </text><AiMessage text={m.text} style={style} /></box>
            ) : (
              <text fg={m.who === "you" ? "white" : "gray"}>{m.who === "you" ? "> " : "· "}{m.text}</text>
            )}
          </React.Fragment>);
        })}
        {draft ? <AiMessage text={draft} style={style} /> : null}
      </scrollbox>
      {pending ? (
        <box flexDirection="column" paddingX={1} backgroundColor="#1e293b">          <text fg="yellow">Permission needed: {pending.tool}</text>
          <text fg="gray">{redactSecrets(pending.args).slice(0, 200)}</text>
          <DiffView name={pending.tool} args={pending.args} />
          <select focused options={[
            { name: "Allow once", description: "this call" },
            { name: "Allow always", description: "remember" },
            { name: "Deny", description: "block" },
          ]} onSelect={(idx) => {
            const r = approveRef.current;
            approveRef.current = null;
            const tool = pending?.tool ?? "?";
            if (idx === 1) {
              policy.current.allow.push(tool);
              savePolicy(policy.current);
            } else if (idx === 0) {
              grants.current.add(tool);
            }
            push({ kind: "msg", who: "sys", text: idx === 2 ? `[denied] ${tool}` : `[allowed] ${tool}` });
            setPending(null);
            r?.(idx !== 2);
          }} />
        </box>
      ) : null}
      {picker ? (
        <box flexDirection="column" paddingX={1} backgroundColor="#1e293b">
          <text><b>Pick a model (Esc cancels)</b></text>
          <select focused options={picker.options} onSelect={(idx) => {
            const r = pickRef.current;
            pickRef.current = null;
            setPicker(null);
            r?.(idx);
          }} />
        </box>
      ) : null}
      {askQ ? (
        <box flexDirection="column" paddingX={1} backgroundColor="#1e293b">
          <text fg="cyan">? {askQ.question}</text>
          {askQ.options.map((o, i) => <text key={i} fg="gray">{i + 1}. {o}</text>)}
          <text fg="gray">number or your own answer</text>
        </box>
      ) : null}
      {hintHits.length && !busy && !pending && !picker ? (
        <box paddingX={2} flexDirection="column">
          {hintHits.map((c) => <text key={c} fg="gray">{c}</text>)}
        </box>
      ) : null}
      <box paddingX={1} backgroundColor="#1e293b">
        <text fg="green">› </text>
        <input value={query} onInput={setQuery} onSubmit={(v) => void submit(typeof v === "string" ? v : "")} focused={!busy && !pending && !picker && !askQ} />
      </box>
      <box paddingX={1}>
        <text fg="gray">{cfg.model} · {listSchemas().length} tools · ~{(tokTotal / 1000).toFixed(1)}k · {status}{pending ? ` · APPROVAL ${pending.tool}` : ""}</text>
      </box>
    </box>
  );
}

export async function runReactNativeTui(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) {
    console.log("No config. Run 'hextra setup' first.");
    return;
  }
  let core: typeof import("@androidtui/core");
  let react: typeof import("@androidtui/react");
  try {
    core = await import("@androidtui/core");
    react = await import("@androidtui/react");
  } catch (e) {
    console.log(`native TUI unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  wireTools(cfg.workspace);
  const renderer = await core.createCliRenderer();
  let style: import("@androidtui/core").SyntaxStyle | null = null;
  try {
    const { SyntaxStyle } = await import("@androidtui/core");
    style = SyntaxStyle.create();
  } catch {
    style = null;
  }
  await new Promise<void>((resolve) => {
    const root = react.createRoot(renderer);
    const exit = () => {
      try {
        root.unmount();
      } catch { /* already gone */ }
      try {
        renderer.destroy();
      } catch { /* already gone */ }
      resolve();
    };
    process.on("SIGINT", exit);
    root.render(<App cfg={cfg} style={style} onExit={exit} />);
  });
}
