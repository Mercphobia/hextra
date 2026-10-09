import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@hextra/core/config.js";

function logPath(): string {
  mkdirSync(dataDir(), { recursive: true });
  return join(dataDir(), "memory.jsonl");
}

export function saveMemory(entry: string): void {
  appendFileSync(logPath(), JSON.stringify({ ts: new Date().toISOString(), text: entry }) + "\n");
}

export function recallMemory(query: string, limit = 8): string {
  if (!existsSync(logPath())) return "";
  const lines = readFileSync(logPath(), "utf8").split("\n").filter(Boolean);
  const q = query.toLowerCase().split(/\s+/);
  const scored = lines
    .map((l) => {
      try {
        const o = JSON.parse(l) as { text: string };
        const t = o.text.toLowerCase();
        const score = q.filter((w) => w && t.includes(w)).length;
        return { score, text: o.text };
      } catch {
        return { score: 0, text: "" };
      }
    })
    .filter((x) => x.score > 0)
    .slice(-limit);
  return scored.map((x) => `- ${x.text}`.slice(0, 300)).join("\n");
}
