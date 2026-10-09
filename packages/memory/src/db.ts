import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@hextra/core/config.js";
import { searchMemory } from "./fts.js";
import { redactSecrets } from "@hextra/core/secrets.js";

function logPath(ns = ""): string {
  mkdirSync(dataDir(), { recursive: true });
  return join(dataDir(), ns ? `memory-${ns.replace(/[^a-z0-9-_]/gi, "_")}.jsonl` : "memory.jsonl");
}

export function saveMemory(entry: string, ns = ""): void {
  appendFileSync(logPath(ns), JSON.stringify({ ts: new Date().toISOString(), text: redactSecrets(entry) }) + "\n");
}

export function recallMemory(query: string, limit = 8, ns = ""): string {
  return searchMemory(query, limit, ns);
}
