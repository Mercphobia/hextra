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
  onTool?: (name: string, phase: "start" | "done" | "denied", ms?: number) => void;
  approve?: (toolName: string, argsJson: string) => Promise<boolean>;
}): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    ...(opts.history ?? []),
    { role: "user", content: opts.input },
  ];
  const max = opts.maxIterations ?? 12;
  for (let i = 0; i < max; i++) {
    const res = await chatWithFallback(opts.cfg, messages, opts.tools, { onToken: opts.onToken });
    if (!res.toolCalls.length) {
      messages.push({ role: "assistant", content: res.content });
      return res.content;
    }
    messages.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls });
    for (const tc of res.toolCalls) {
      const name = tc.function.name;
      if (opts.approve && !(await opts.approve(name, tc.function.arguments))) {
        opts.onTool?.(name, "denied");
        messages.push({ role: "tool", tool_call_id: tc.id, content: "denied by user" });
        continue;
      }
      opts.onTool?.(name, "start");
      const t0 = Date.now();
      let out: string;
      try {
        const handler = opts.handlers[name];
        out = handler ? await handler(tc.function.arguments) : `unknown tool: ${name}`;
      } catch (e) {
        out = `tool error: ${e instanceof Error ? e.message : String(e)}`;
      }
      opts.onTool?.(name, "done", Date.now() - t0);
      messages.push({ role: "tool", tool_call_id: tc.id, content: out.slice(0, 8000) });
    }
  }
  return "(stopped: max tool iterations reached)";
}
