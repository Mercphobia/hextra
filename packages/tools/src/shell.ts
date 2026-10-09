import { execFile } from "node:child_process";

const DENY = /\brm\s+-rf\s+\/|mkfs|dd\s+if=|:(){:|:&};:|shutdown|reboot|passwd|useradd/i;

const ALLOW_BIN = new Set(["ls", "cat", "echo", "pwd", "git", "head", "tail", "wc", "grep", "find", "node", "npm"]);

export function runShell(workspace: string, command: string, timeoutMs = 30_000): Promise<string> {
  if (DENY.test(command)) return Promise.resolve("denied: destructive command blocked");
  const bin = command.trim().split(/\s+/)[0];
  if (!ALLOW_BIN.has(bin)) return Promise.resolve(`denied: binary '${bin}' not in allowlist`);
  return new Promise((resolve) => {
    execFile("bash", ["-c", command], { cwd: workspace, timeout: timeoutMs, maxBuffer: 512_000 }, (err, stdout, stderr) => {
      const tail = (stdout + stderr).slice(-4000);
      resolve(err ? `exit error: ${err.message}\n${tail}` : tail || "(empty output)");
    });
  });
}
