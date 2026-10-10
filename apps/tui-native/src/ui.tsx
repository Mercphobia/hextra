/** @jsxImportSource @androidtui/react */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, useKeyboard } from "@androidtui/react";
import type { SyntaxStyle } from "@androidtui/core";
import { loadConfig, saveConfig, type HextraConfig } from "@hextra/core/config.js";
import { runAgentLoop, compressHistory } from "@hextra/core/agent-loop.js";
import { deleteSession, listSessions, loadSession, newSession, saveSession } from "@hextra/core/sessions.js";
import { getBot, loadBots, type BotProfile } from "@hextra/core/bots.js";
import { buildSystemPrompt } from "@hextra/core/prompt-builder.js";
import { handlers, listSchemas } from "@hextra/tools/registry.js";
import { connectMcpServers } from "@hextra/tools/mcp.js";
import { decide, loadPolicy, savePolicy, parseApprovalAnswer, effectiveApproval } from "@hextra/tools/permissions.js";
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

const SLASH = ["/new", "/sessions", "/resume", "/rm", "/yolo", "/model", "/models", "/skills", "/usage", "/undo", "/compress", "/expand", "/bot", "/help", "/quit"];

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

function Editor({ value, onChange, onSubmit, onExit, disabled, sentHistory }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onExit: () => void;
  disabled: boolean;
  sentHistory: string[];
}) {
  const stateRef = useRef({ text: "", cursor: 0, anchor: null as number | null });
  stateRef.current.text = value;
  const clampPos = (text: string, p: number) => Math.max(0, Math.min(text.length, p));
  const lineStarts = (text: string): number[] => {
    const out = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") out.push(i + 1);
    return out;
  };
  const moveLine = (text: string, cursor: number, dir: -1 | 1): number => {
    const starts = lineStarts(text);
    let li = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= cursor) li = i;
    const col = cursor - starts[li];
    const target = li + dir;
    if (target < 0) return 0;
    if (target >= starts.length) return text.length;
    const lineEnd = target + 1 < starts.length ? starts[target + 1] - 1 : text.length;
    return Math.min(starts[target] + col, lineEnd);
  };
  const histIdx = useRef(-1);
  useKeyboard((k) => {
    if (disabled) return;
    const st = stateRef.current;
    if (k.name === "c" && k.ctrl) {
      onExit();
      return;
    }
    if (k.name === "escape") {
      if (st.anchor !== null) {
        st.anchor = null;
        onChange(st.text);
      } else {
        onChange("");
      }
      st.cursor = Math.min(st.cursor, st.text.length);
      return;
    }
    const commit = (text: string, cursor: number, anchor: number | null) => {
      st.cursor = clampPos(text, cursor);
      st.anchor = anchor === null ? null : clampPos(text, anchor);
      onChange(text);
    };
    const selRange = (): [number, number] | null => {
      if (st.anchor === null || st.anchor === st.cursor) return null;
      return [Math.min(st.anchor, st.cursor), Math.max(st.anchor, st.cursor)];
    };
    if ((k.name === "return" || k.name === "kpenter") && (k.meta || k.ctrl)) {
      const v = st.text;
      commit("", 0, null);
      histIdx.current = -1;
      onSubmit(v);
      return;
    }
    if (k.name === "return" || k.name === "kpenter" || k.name === "linefeed") {
      const sel = selRange();
      const base = sel ? st.text.slice(0, sel[0]) + st.text.slice(sel[1]) : st.text;
      const at = sel ? sel[0] : st.cursor;
      commit(`${base.slice(0, at)}\n${base.slice(at)}`, at + 1, null);
      return;
    }
    if (k.name === "backspace") {
      const sel = selRange();
      if (sel) {
        commit(st.text.slice(0, sel[0]) + st.text.slice(sel[1]), sel[0], null);
      } else if (st.cursor > 0) {
        commit(st.text.slice(0, st.cursor - 1) + st.text.slice(st.cursor), st.cursor - 1, null);
      }
      return;
    }
    if (k.name === "delete") {
      const sel = selRange();
      if (sel) {
        commit(st.text.slice(0, sel[0]) + st.text.slice(sel[1]), sel[0], null);
      } else if (st.cursor < st.text.length) {
        commit(st.text.slice(0, st.cursor) + st.text.slice(st.cursor + 1), st.cursor, null);
      }
      return;
    }
    if (k.name === "left" || k.name === "right") {
      const dir = k.name === "left" ? -1 : 1;
      const anchor = k.shift ? (st.anchor ?? st.cursor) : null;
      commit(st.text, st.cursor + dir, anchor);
      return;
    }
    if (k.name === "up" || k.name === "down") {
      if (k.shift) {
        commit(st.text, moveLine(st.text, st.cursor, k.name === "up" ? -1 : 1), st.anchor ?? st.cursor);
        return;
      }
      if (!k.shift && st.text.includes("\n")) {
        commit(st.text, moveLine(st.text, st.cursor, k.name === "up" ? -1 : 1), null);
        return;
      }
      if (k.name === "up" && sentHistory.length) {
        histIdx.current = Math.min(histIdx.current + 1, sentHistory.length - 1);
        const v = sentHistory[sentHistory.length - 1 - histIdx.current] ?? "";
        commit(v, v.length, null);
      } else if (k.name === "down") {
        if (histIdx.current > 0) {
          histIdx.current -= 1;
          const v = sentHistory[sentHistory.length - 1 - histIdx.current] ?? "";
          commit(v, v.length, null);
        } else {
          histIdx.current = -1;
          commit("", 0, null);
        }
      }
      return;
    }
    if (k.name === "home") {
      const starts = lineStarts(st.text);
      let li = 0;
      for (let i = 0; i < starts.length; i++) if (starts[i] <= st.cursor) li = i;
      commit(st.text, starts[li], k.shift ? (st.anchor ?? st.cursor) : null);
      return;
    }
    if (k.name === "end") {
      const starts = lineStarts(st.text);
      let li = 0;
      for (let i = 0; i < starts.length; i++) if (starts[i] <= st.cursor) li = i;
      const end = li + 1 < starts.length ? starts[li + 1] - 1 : st.text.length;
      commit(st.text, end, k.shift ? (st.anchor ?? st.cursor) : null);
      return;
    }
    if (k.sequence && k.sequence.length === 1 && !k.ctrl && !k.meta && k.eventType !== "release") {
      if (k.sequence >= " " || k.sequence === "\t") {
        const sel = selRange();
        const base = sel ? st.text.slice(0, sel[0]) + st.text.slice(sel[1]) : st.text;
        const at = sel ? sel[0] : st.cursor;
        commit(`${base.slice(0, at)}${k.sequence}${base.slice(at)}`, at + 1, null);
      }
    }
  });
  const st = stateRef.current;
  st.cursor = clampPos(value, st.cursor);
  st.anchor = st.anchor === null ? null : clampPos(value, st.anchor);
  const sel = st.anchor !== null && st.anchor !== st.cursor
    ? ([Math.min(st.anchor, st.cursor), Math.max(st.anchor, st.cursor)] as const)
    : null;
  const before = sel ? value.slice(0, sel[0]) : value.slice(0, st.cursor);
  const marked = sel ? value.slice(sel[0], sel[1]) : "";
  const after = sel ? value.slice(sel[1]) : value.slice(st.cursor);
  return (
    <>
      {before.split("\n").map((r, i, arr) => (
        <text key={`b${i}`}>{i === arr.length - 1 && !sel ? `${r}▊` : r}</text>
      ))}
      {sel ? <text><span bg="blue">{`${marked}▊`}</span></text> : null}
      {after ? <text>{after}</text> : null}
    </>
  );
}

function App({ cfg, style, onExit }: { cfg: HextraConfig; style: SyntaxStyle | null; onExit: () => void }) {
  const [items, setItems] = useState<TItem[]>([
    { kind: "msg", who: "sys", text: "hextra native — type / for commands." },
  ]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [status, setStatus] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ tool: string; args: string } | null>(null);
  const [askQ, setAskQ] = useState<{ question: string; options: string[] } | null>(null);
  const askRef = useRef<((text: string) => void) | null>(null);
  const [picker, setPicker] = useState<{ options: { name: string; description: string }[] } | null>(null);
  const [activeBot, setActiveBot] = useState<BotProfile | null>(null);
  const [tokTotal, setTokTotal] = useState(0);
  const [sentHist, setSentHist] = useState<string[]>([]);
  const [yolo, setYolo] = useState(process.argv.includes("--yolo") || effectiveApproval(cfg, false) === "auto");
  const history = useRef<ChatMessage[]>([]);
  const sessionRef = useRef(newSession(cfg.model));
  const draftRef = useRef("");
  const reasonRef = useRef("");
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
      sessionRef.current = newSession(cfg.model, activeBot?.name ?? undefined);
      setItems([]);
      setStatus("idle");
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
    if (input === "/yolo") {
      setYolo((v) => !v);
      push({ kind: "msg", who: "sys", text: `yolo ${!yolo ? "ON" : "OFF"}` });
      return;
    }
    if (input === "/help") {
      push({ kind: "msg", who: "sys", text: "/new /sessions /resume /rm /yolo /model <name> /models /skills /usage /undo /compress /expand /bot <name> /help /quit" });
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
        pickRef.current = (idx: number) => {
          if (idx >= 0 && idx < models.length) {
            cfg.model = models[idx];
            saveConfig(cfg);
            push({ kind: "msg", who: "sys", text: `model -> ${cfg.model}` });
          }
          setStatus("idle");
        };
        setPicker({ options: models.map((m) => ({ name: m, description: m === cfg.model ? "current" : "" })) });
      } catch (e) {
        push({ kind: "msg", who: "sys", text: `models failed: ${e instanceof Error ? e.message : String(e)}` });
        setStatus("idle");
      }
      return;
    }
    if (input === "/sessions") {
      const all = listSessions();
      if (!all.length) {
        push({ kind: "msg", who: "sys", text: "(no sessions)" });
        return;
      }
      pickRef.current = (idx: number) => {
        if (idx < 0 || idx >= all.length) return;
        const loaded = loadSession(all[idx].id);
        if (!loaded) {
          push({ kind: "msg", who: "sys", text: "session gone" });
          return;
        }
        sessionRef.current = loaded;
        history.current = loaded.history;
        push({ kind: "msg", who: "sys", text: `resumed ${loaded.id} :: ${loaded.title}` });
      };
      setPicker({ options: all.map((s) => ({ name: s.title || s.id, description: `${s.id.slice(0, 8)} · ${s.updated.slice(0, 10)}` })) });
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
    if (!input.startsWith("/")) setSentHist((h) => [...h.slice(-50), input]);
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
          if (yolo) return decide(policy.current, grants.current, tool) !== "deny";
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
      setReasoning("");
      setDraft("");
      history.current = [...history.current.slice(-18), { role: "user", content: clamped }, { role: "assistant", content: out }];
      sessionRef.current.history = history.current;
      sessionRef.current.model = cfg.model;
      saveSession(sessionRef.current);
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
        {reasoning ? <text fg="gray">∴ {reasoning}</text> : null}
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
            try {
              r?.(idx);
            } catch (e) {
              push({ kind: "msg", who: "sys", text: `picker failed: ${e instanceof Error ? e.message : String(e)}` });
            }
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
        <text fg="gray">Enter newline · Alt+Enter send · ↑ history</text>
        <Editor
          value={query}
          onChange={setQuery}
          onSubmit={(v) => void submit(v)}
          onExit={onExit}
          disabled={busy && !pending && !askQ}
          sentHistory={sentHist}
        />
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
    // Theme token colors from the terminal palette (OpenCode-style adaptive theme).
    let dark = true;
    try {
      const pal = await renderer.getPalette({ timeout: 1500 });
      const bg = pal.defaultBackground ?? "#000000";
      const m = bg.replace("#", "");
      if (m.length >= 6) {
        const r = parseInt(m.slice(0, 2), 16);
        const g = parseInt(m.slice(2, 4), 16);
        const b = parseInt(m.slice(4, 6), 16);
        dark = (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
      }
    } catch { /* keep dark default */ }
    const tok: Record<string, { fg: string }> = dark
      ? {
          keyword: { fg: "#c792ea" }, string: { fg: "#c3e88d" }, comment: { fg: "#546e7a" },
          function: { fg: "#82aaff" }, type: { fg: "#ffcb6b" }, number: { fg: "#f78c6c" },
          operator: { fg: "#89ddff" }, variable: { fg: "#eeffff" }, constant: { fg: "#ff9cac" },
        }
      : {
          keyword: { fg: "#7c3aed" }, string: { fg: "#15803d" }, comment: { fg: "#64748b" },
          function: { fg: "#1d4ed8" }, type: { fg: "#b45309" }, number: { fg: "#c2410c" },
          operator: { fg: "#0e7490" }, variable: { fg: "#1e293b" }, constant: { fg: "#be123c" },
        };
    for (const [name, def] of Object.entries(tok)) {
      try {
        style.registerStyle(name, def);
      } catch { /* unknown scope, ignore */ }
    }
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
