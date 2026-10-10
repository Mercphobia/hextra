export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ProviderProfile {
  baseUrl: string;
  apiKey: string;
  model: string;
}

async function readSseStream(
  res: Response,
  onToken: (t: string) => void,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  if (!res.body) throw new Error("empty response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  const toolCalls: ToolCall[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta;
        if (typeof delta?.content === "string") {
          content += delta.content;
          onToken(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const existing = toolCalls.find((x) => x.id === tc.id || x.function.name === tc.function?.name);
          if (existing && tc.function?.arguments) {
            existing.function.arguments += tc.function.arguments;
          } else if (tc.id) {
            toolCalls.push({
              id: tc.id,
              type: "function",
              function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "" },
            });
          }
        }
      } catch { /* skip partial SSE frame */ }
    }
  }
  return { content, toolCalls };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chatCompletions(
  profile: ProviderProfile,
  messages: ChatMessage[],
  tools: ToolSchema[] = [],
  opts: { timeoutMs?: number; onToken?: (t: string) => void } = {},
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  // Self-hosted providers often rate-limit bursts (e.g. 1 req / 4s).
  // Retry 429s with a cooldown instead of failing the whole turn.
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(4500);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180_000);
    try {
      const res = await fetch(`${profile.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${profile.apiKey}`,
          "HTTP-Referer": "https://github.com/Mercphobia/hextra",
          "X-Title": "hextra",
        },
        body: JSON.stringify({
          model: profile.model,
          messages,
          tools: tools.length ? tools : undefined,
          stream: true,
        }),
      });
      if (res.status === 429) {
        lastErr = (await res.text()).slice(0, 300);
        continue;
      }
      if (!res.ok) throw new Error(`provider ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return await readSseStream(res, opts.onToken ?? (() => {}));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`provider 429 (rate limited after retries): ${lastErr}`);
}

export async function testConnection(profile: ProviderProfile): Promise<{ ok: boolean; detail: string }> {  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(`${profile.baseUrl.replace(/\/$/, "")}/models`, {
        signal: ctrl.signal,
        headers: { authorization: `Bearer ${profile.apiKey}` },
      });
      if (!res.ok) return { ok: false, detail: `GET /models -> ${res.status}` };
    } finally {
      clearTimeout(timer);
    }
    const mini = await chatCompletions(profile, [{ role: "user", content: "reply with: ok" }], [], {
      timeoutMs: 90_000,
    });
    return { ok: true, detail: `chat ok: ${mini.content.slice(0, 40) || "(empty)"}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Live model list for the interactive /models picker. */
export async function listModels(profile: ProviderProfile): Promise<string[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${profile.baseUrl.replace(/\/$/, "")}/models`, {
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${profile.apiKey}` },
    });
    if (!res.ok) throw new Error(`GET /models -> ${res.status}`);
    const json = (await res.json()) as { data?: { id?: string }[] };
    return (json.data ?? []).map((m) => m.id ?? "").filter(Boolean).slice(0, 30);
  } finally {
    clearTimeout(timer);
  }
}
