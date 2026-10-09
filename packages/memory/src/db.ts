import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@hextra/core/config.js";
import { searchMemory } from "./fts.js";

function logPath(): string {
  mkdirSync(dataDir(), { recursive: true });
  return join(dataDir(), "memory.jsonl");
}

export function saveMemory(entry: string): void {
  appendFileSync(logPath(), JSON.stringify({ ts: new Date().toISOString(), text: entry }) + "\n");
}

export function recallMemory(query: string, limit = 8): string {
  return searchMemory(query, limit);
}
