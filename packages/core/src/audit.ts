import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./config.js";
import { redactSecrets } from "./secrets.js";

export interface AuditEntry {
  tool: string;
  args: string;
  phase: "done" | "denied" | "error";
  ms?: number;
}

/** Append-only redacted audit trail of every tool invocation. */
export function audit(entry: AuditEntry): void {
  mkdirSync(dataDir(), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    tool: entry.tool,
    args: redactSecrets(entry.args).slice(0, 500),
    phase: entry.phase,
    ms: entry.ms,
  });
  appendFileSync(join(dataDir(), "audit.log"), `${line}\n`);
}
