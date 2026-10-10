import type { HextraConfig } from "../config.js";
import { chatCompletions, type ChatMessage, type ProviderProfile, type ToolSchema } from "./openai-client.js";

export function primaryProfile(cfg: HextraConfig): ProviderProfile {
  return { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model };
}

export function fallbackProfile(cfg: HextraConfig): ProviderProfile | null {
  if (!cfg.fallbackBaseUrl || !cfg.fallbackModel) return null;
  return { baseUrl: cfg.fallbackBaseUrl, apiKey: "local", model: cfg.fallbackModel };
}

function isRetriable(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /abort|timeout|ECONN|ENOTFOUND|fetch failed|502|503|504|429/i.test(m);
}

/** Primary cloud first, local fallback on network/timeout errors. */
export async function chatWithFallback(
  cfg: HextraConfig,
  messages: ChatMessage[],
  tools: ToolSchema[] = [],
  opts: { onToken?: (t: string) => void; onReasoning?: (t: string) => void } = {},
) {
  try {
    return await chatCompletions(primaryProfile(cfg), messages, tools, opts);
  } catch (err) {
    const fb = fallbackProfile(cfg);
    if (fb && isRetriable(err)) return chatCompletions(fb, messages, tools, opts);
    throw err;
  }
}
