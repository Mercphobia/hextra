const API = "https://api.telegram.org";

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number };
  text?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

async function call<T>(token: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 40_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    const json = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) throw new Error(`telegram ${method}: ${json.description ?? res.status}`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

export function getUpdates(token: string, offset: number): Promise<TgUpdate[]> {
  return call(token, "getUpdates", { offset, timeout: 30, allowed_updates: ["message"] }, 40_000);
}

/** Split over-long texts on the 4096-char Bot API limit. */
export function splitMessage(text: string, limit = 4096): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  const lines = text.split("\n");
  let cur = "";
  for (const line of lines) {
    if ((cur + "\n" + line).length > limit && cur) {
      parts.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${line}` : line;
    while (cur.length > limit) {
      parts.push(cur.slice(0, limit));
      cur = cur.slice(limit);
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

export async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  for (const part of splitMessage(text)) {
    await call(token, "sendMessage", { chat_id: chatId, text: part || "(empty)" });
  }
}

export async function sendTyping(token: string, chatId: number): Promise<void> {
  try {
    await call(token, "sendChatAction", { chat_id: chatId, action: "typing" }, 10_000);
  } catch { /* presence is best-effort */ }
}

/** Parse /command plus body from a message. */
export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const space = t.indexOf(" ");
  const raw = (space < 0 ? t : t.slice(0, space)).split("@")[0];
  return { cmd: raw.slice(1).toLowerCase(), arg: space < 0 ? "" : t.slice(space + 1).trim() };
}
