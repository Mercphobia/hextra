import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertInside } from "./fs.js";

export function writeFile(workspace: string, target: string, content: string): string {
  const abs = assertInside(workspace, target);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return `wrote ${content.length} bytes to ${target}`;
}
