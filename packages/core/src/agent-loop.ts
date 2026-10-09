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
  tools: ToolSchema[];
  handlers: Record<string, ToolHandler>;
  maxIterations?: number;
  onToken?: (t: string) => void;
}): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
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
      const handler = opts.handlers[tc.function.name];
      let out: string;
      try {
        out = handler ? await handler(tc.function.arguments) : `unknown tool: ${tc.function.name}`;
      } catch (e) {
        out = `tool error: ${e instanceof Error ? e.message : String(e)}`;
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: out.slice(0, 8000) });
    }
  }
  return "(stopped: max tool iterations reached)";
}
