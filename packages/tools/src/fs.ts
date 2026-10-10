import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

export function assertInside(workspace: string, target: string): string {
  const abs = resolve(workspace, target);
  const roots = [resolve(workspace), ...extraRoots.map((r) => resolve(r))];
  const ok = roots.some((root) => root === abs || !relative(root, abs).startsWith(".."));
  if (!ok) throw new Error(`path escape denied: ${target} (outside workspace and allowed roots)`);
  return abs;
}

const extraRoots: string[] = [];

/** Additional readable/writable roots beyond the workspace (testing). */
export function setExtraRoots(roots: string[]): void {
  extraRoots.length = 0;
  extraRoots.push(...roots.filter(Boolean));
}

export function readFile(workspace: string, target: string, maxBytes = 60_000): string {
  const abs = assertInside(workspace, target);
  return readFileSync(abs, "utf8").slice(0, maxBytes);
}

export function grepFiles(workspace: string, pattern: string, ext = ""): string[] {
  const ws = resolve(workspace);
  const out: string[] = [];
  const re = new RegExp(pattern);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (out.length >= 50) return;
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (e === "node_modules" || e === ".git" || e === "dist") continue;
        walk(p);
      } else if (!ext || p.endsWith(ext)) {
        try {
          const text = readFileSync(p, "utf8");
          if (re.test(text)) out.push(relative(ws, p));
        } catch { /* skip binary */ }
      }
    }
  };
  walk(ws);
  return out;
}
