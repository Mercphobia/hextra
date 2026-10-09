import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export function globFiles(workspace: string, pattern: string): string[] {
  const ws = resolve(workspace);
  const re = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (out.length >= 100) return;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        if (e === "node_modules" || e === ".git" || e === "dist") continue;
        walk(p);
      } else if (re.test(relative(ws, p))) {
        out.push(relative(ws, p));
      }
    }
  };
  walk(ws);
  return out;
}
