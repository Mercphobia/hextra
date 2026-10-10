import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "@hextra/core/config.js";

export interface Policy {
  allow: string[];
  deny: string[];
}

/** Tools that always ask unless explicitly allowed. Mirrors Hermes approval.py. */
export const RISKY_TOOLS = new Set(["shell", "write_file", "edit_file"]);

import type { ApprovalMode } from "@hextra/core/config.js";
export type { ApprovalMode } from "@hextra/core/config.js";

/** effectiveApproval resolves yolo mode: CLI flag wins, then config, default strict. */

export function effectiveApproval(cfg: { approval?: ApprovalMode }, cliYolo: boolean): ApprovalMode {
  if (cliYolo) return "auto";
  return cfg.approval ?? "strict";
}

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

/** Natural-language approval answers shared by all TUIs (English + Indonesian). */
export function parseApprovalAnswer(ans: string): "once" | "always" | "deny" {
  const a = ans.trim().toLowerCase();
  if (["w", "always", "selalu"].includes(a)) return "always";
  if (["a", "al", "allow", "y", "yes", "ya", "iya", "ok", "oke", "okay", "boleh", "lanjut", "gas", "yoi", "sip", "setuju", ""].includes(a)) return "once";
  return "deny";
}
