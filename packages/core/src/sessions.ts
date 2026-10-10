import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./config.js";
import type { ChatMessage } from "./llm/openai-client.js";

export interface Session {
  id: string;
  title: string;
  model: string;
  bot?: string;
  created: string;
  updated: string;
  history: ChatMessage[];
}

function dir(): string {
  const d = join(dataDir(), "sessions");
  mkdirSync(d, { recursive: true });
  return d;
}

function path(id: string): string {
  return join(dir(), `${id.replace(/[^a-z0-9-_]/gi, "_")}.json`);
}

export function newSession(model: string, bot?: string): Session {
  const now = new Date().toISOString();
  return {
    id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    title: "untitled",
    model,
    bot,
    created: now,
    updated: now,
    history: [],
  };
}

export function saveSession(s: Session): void {
  if (!s.title || s.title === "untitled") {
    const first = s.history.find((m) => m.role === "user");
    if (first) s.title = first.content.slice(0, 60);
  }
  s.updated = new Date().toISOString();
  writeFileSync(path(s.id), JSON.stringify(s));
}

export function loadSession(id: string): Session | null {
  try {
    if (existsSync(path(id))) return JSON.parse(readFileSync(path(id), "utf8")) as Session;
  } catch { /* corrupt -> null */ }
  return null;
}

export function listSessions(): { id: string; title: string; updated: string }[] {
  return readdirSync(dir())
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const s = JSON.parse(readFileSync(join(dir(), f), "utf8")) as Session;
        return [{ id: s.id, title: s.title, updated: s.updated }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => (a.updated < b.updated ? 1 : -1))
    .slice(0, 20);
}

export function deleteSession(id: string): boolean {
  try {
    if (existsSync(path(id))) {
      rmSync(path(id));
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
