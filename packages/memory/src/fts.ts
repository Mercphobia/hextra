import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@hextra/core/config.js";

export interface MemoryEntry {
  ts: string;
  text: string;
}

export function readEntries(): MemoryEntry[] {
  const p = join(dataDir(), "memory.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        const o = JSON.parse(l) as MemoryEntry;
        return o.text ? [o] : [];
      } catch {
        return [];
      }
    });
}

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
}

/** Ranked full-text search: term hits weigh most, recency breaks ties. */
export function searchMemory(query: string, limit = 8): string {
  const entries = readEntries();
  const q = new Set(tokens(query));
  if (!q.size || !entries.length) return "";
  return entries
    .map((e, i) => {
      const hits = tokens(e.text).filter((w) => q.has(w)).length;
      return { hits, score: hits * 2 + i / entries.length, text: e.text };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => `- ${x.text}`.slice(0, 300))
    .join("\n");
}
