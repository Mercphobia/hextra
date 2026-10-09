import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "@hextra/core/config.js";

export interface Policy {
  allow: string[];
  deny: string[];
}

/** Tools that always ask unless explicitly allowed. Mirrors Hermes approval.py. */
export const RISKY_TOOLS = new Set(["shell", "write_file", "edit_file"]);

function path(): string {
  mkdirSync(configDir(), { recursive: true });
  return join(configDir(), "permissions.json");
}

export function loadPolicy(): Policy {
  try {
    if (existsSync(path())) return JSON.parse(readFileSync(path(), "utf8")) as Policy;
  } catch { /* defaults */ }
  return { allow: ["read_file", "glob", "grep", "webfetch", "memory_recall"], deny: [] };
}

export function savePolicy(p: Policy): void {
  writeFileSync(path(), JSON.stringify(p, null, 2), { mode: 0o600 });
}

export function decide(p: Policy, sessionGrants: Set<string>, tool: string): "allow" | "ask" | "deny" {
  if (p.deny.includes(tool)) return "deny";
  if (p.allow.includes(tool) || sessionGrants.has(tool)) return "allow";
  if (!RISKY_TOOLS.has(tool)) return "allow";
  return "ask";
}
