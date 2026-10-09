import { readFileSync, writeFileSync } from "node:fs";
import { assertInside } from "./fs.js";

export function editFile(workspace: string, target: string, search: string, replace: string): string {
  const abs = assertInside(workspace, target);
  const text = readFileSync(abs, "utf8");
  const hits = text.split(search).length - 1;
  if (hits === 0) return `edit failed: search block not found in ${target}`;
  if (hits > 1) return `edit failed: ${hits} matches in ${target}, be more specific`;
  writeFileSync(abs, text.replace(search, replace));
  return `edited ${target}: 1 block replaced`;
}
