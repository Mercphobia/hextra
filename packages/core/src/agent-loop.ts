import type { HextraConfig } from "./config.js";
import { chatWithFallback } from "./llm/router.js";
import type { ChatMessage, ToolSchema } from "./llm/openai-client.js";
export interface ToolHandler {
  (argsJson: string): Promise<string>;
}

export async function runAgentLoop(opts: {
  cfg: HextraConfig;
  system: string;
  input: string;
  history?: ChatMessage[];
  tools: ToolSchema[];
  handlers: Record<string, ToolHandler>;
  maxIterations?: number;
  onToken?: (t: string) => void;
  onReasoning?: (t: string) => void;
  onTool?: (name: string, phase: "start" | "done" | "denied", ms?: number, detail?: { id: string; args: string; result?: string }) => void;
  approve?: (toolName: string, argsJson: string) => Promise<boolean>;
}): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    ...(opts.history ?? []),
    { role: "user", content: opts.input },
  ];
  const maxRaw = opts.maxIterations ?? opts.cfg.maxIterations ?? 50;
  const max = maxRaw <= 0 ? Number.POSITIVE_INFINITY : maxRaw;
  for (let i = 0; i < max; i++) {
    const res = await chatWithFallback(opts.cfg, messages, opts.tools, { onToken: opts.onToken, onReasoning: opts.onReasoning });
    if (!res.toolCalls.length) {
      messages.push({ role: "assistant", content: res.content });
      return res.content;
    }
    messages.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls });
    for (const tc of res.toolCalls) {
      const name = tc.function.name;
      if (opts.approve && !(await opts.approve(name, tc.function.arguments))) {
        opts.onTool?.(name, "denied", undefined, { id: tc.id, args: tc.function.arguments });
        messages.push({ role: "tool", tool_call_id: tc.id, content: "denied by user" });
        continue;
      }
      opts.onTool?.(name, "start", undefined, { id: tc.id, args: tc.function.arguments });
      const t0 = Date.now();
      let out: string;
      try {
        const handler = opts.handlers[name];
        out = handler ? await handler(tc.function.arguments) : `unknown tool: ${name}`;
      } catch (e) {
        out = `tool error: ${e instanceof Error ? e.message : String(e)}`;
      }
      opts.onTool?.(name, "done", Date.now() - t0, { id: tc.id, args: tc.function.arguments, result: out });
      messages.push({ role: "tool", tool_call_id: tc.id, content: out.slice(0, 8000) });
    }
  }
  return `(stopped after ${max} tool iterations — raise maxIterations in config, set 0 for unlimited, or say 'lanjutkan' to continue)`;
}

/** Summarize a session into one replacement memory turn (OpenCode /compress). */
export async function compressHistory(cfg: HextraConfig, history: ChatMessage[]): Promise<ChatMessage[]> {
  if (!history.length) return history;
  const res = await chatWithFallback(cfg, [
    { role: "system", content: "Summarize this coding session into dense notes: goals, decisions, file changes, open tasks. Keep under 1500 chars." },
    { role: "user", content: history.map((m) => `${m.role}: ${m.content.slice(0, 2000)}`).join("\n\n").slice(0, 12000) },
  ]);
  return [{ role: "user", content: `(session summary) ${res.content.slice(0, 2000)}` }];
}
