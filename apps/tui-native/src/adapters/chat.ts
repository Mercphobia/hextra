import { createSignal } from "solid-js";
import type { HextraConfig } from "@hextra/core/config.js";
import { runAgentLoop } from "@hextra/core/agent-loop.js";
import { buildSystemPrompt } from "@hextra/core/prompt-builder.js";
import { handlers, listSchemas } from "@hextra/tools/registry.js";
import { connectMcpServers } from "@hextra/tools/mcp.js";
import { decide, loadPolicy, savePolicy } from "@hextra/tools/permissions.js";
import { recallMemory, saveMemory } from "@hextra/memory/db.js";
import { loadSkills, saveSkill } from "@hextra/memory/skills.js";
import { audit } from "@hextra/core/audit.js";
import { clampInput, redactSecrets } from "@hextra/core/secrets.js";
import type { ChatMessage } from "@hextra/core/llm/openai-client.js";
import { wireTools } from "@hextra/tools/wiring.js";
import { setAskHandler } from "@hextra/tools/ask.js";
import type { Session } from "@hextra/core/sessions.js";
import { saveSession } from "@hextra/core/sessions.js";

export type TranscriptItem =
  | { kind: "msg"; who: "you" | "ai" | "sys" | "reasoning"; text: string }
  | { kind: "tool"; id: number; callId: string; name: string; args: string; status: "running" | "done" | "denied"; ms?: number; result?: string };

export interface ApprovalRequest {
  tool: string;
  args: string;
}

export interface ChatCallbacks {
  onApprove: (req: ApprovalRequest) => Promise<"once" | "always" | "deny">;
  onAsk: (question: string, options: string[]) => Promise<string>;
}

/**
 * Chat adapter: transcript signals + turn runner backed by the agent loop.
 * UI components consume signals and supply approval/question dialogs.
 */
export function createChat(cfg: HextraConfig, session: Session, cb: ChatCallbacks) {
  const [items, setItems] = createSignal<TranscriptItem[]>([]);
  const [draft, setDraft] = createSignal("");
  const [reasoning, setReasoning] = createSignal("");
  const [status, setStatus] = createSignal("idle");
  const [busy, setBusy] = createSignal(false);
  const [tokTotal, setTokTotal] = createSignal(0);
  const history: ChatMessage[] = [...session.history];
  const policy = loadPolicy();
  const grants = new Set<string>();
  const draftRef = { current: "" };
  const reasonRef = { current: "" };
  const toolSeq = { current: 0 };
  const mcpStop: (() => void)[] = [];

  const push = (m: TranscriptItem) => setItems((prev) => [...prev.slice(-120), m]);

  async function init(): Promise<void> {
    wireTools(cfg.workspace);
    setAskHandler((question, options) => cb.onAsk(question, options));
    try {
      const mcp = await connectMcpServers(cfg.mcpServers ?? []);
      const { registerTool } = await import("@hextra/tools/registry.js");
      for (const s of mcp.schemas) registerTool(s.function.name, s.function.description, s.function.parameters, mcp.handlers[s.function.name]);
      mcp.clients.forEach((c) => mcpStop.push(() => c.stop()));
    } catch {
      /* optional */
    }
  }

  function stop(): void {
    mcpStop.forEach((fn) => {
      try {
        fn();
      } catch { /* ignore */ }
    });
  }

  async function send(rawInput: string, modelOverride?: string, botSystem?: string, ns = ""): Promise<void> {
    const { text: clamped, truncated } = clampInput(rawInput.trim());
    if (!clamped || busy()) return;
    if (truncated) push({ kind: "msg", who: "sys", text: "(input clamped to 20000 chars)" });
    push({ kind: "msg", who: "you", text: clamped });
    setBusy(true);
    setStatus("thinking…");
    draftRef.current = "";
    setDraft("");
    reasonRef.current = "";
    setReasoning("");
    let toolsUsed = 0;
    const turnCfg = modelOverride ? { ...cfg, model: modelOverride } : cfg;
    try {
      const out = await runAgentLoop({
        cfg: turnCfg,
        system: buildSystemPrompt({ identity: botSystem, skills: loadSkills(), memory: recallMemory("project", 5, ns) }),
        input: clamped,
        history,
        tools: listSchemas(),
        handlers: handlers(),
        approve: async (tool: string, args: string) => {
          const d = decide(policy, grants, tool);
          if (d === "deny") {
            audit({ tool, args, phase: "denied" });
            return false;
          }
          if (d === "allow") return true;
          const ans = await cb.onApprove({ tool, args });
          if (ans === "always") {
            policy.allow.push(tool);
            savePolicy(policy);
          } else if (ans === "once") {
            grants.add(tool);
          }
          return ans !== "deny";
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
            push({ kind: "tool", id: toolSeq.current++, callId: detail?.id ?? "", name, args: redactSecrets(detail?.args ?? ""), status: "running" });
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
      history.push({ role: "user", content: clamped }, { role: "assistant", content: out });
      while (history.length > 20) history.shift();
      setTokTotal((n) => n + Math.round((clamped.length + out.length) / 4));
      session.history = [...history];
      session.model = turnCfg.model;
      saveSession(session);
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
  }

  return { items, push, draft, reasoning, status, busy, tokTotal, history, send, init, stop };
}

export type ChatStore = ReturnType<typeof createChat>;
