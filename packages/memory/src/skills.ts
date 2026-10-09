import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "@hextra/core/config.js";

export function skillsDir(): string {
  const d = join(configDir(), "skills");
  mkdirSync(d, { recursive: true });
  return d;
}

export function listSkills(): string[] {
  const d = skillsDir();
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".md"));
}

export function loadSkills(): string {
  return listSkills()
    .map((f) => `### ${f}\n${readFileSync(join(skillsDir(), f), "utf8").slice(0, 2000)}`)
    .join("\n\n");
}

export function saveSkill(name: string, body: string): void {
  const safe = name.replace(/[^a-z0-9-_]/gi, "_");
  writeFileSync(join(skillsDir(), `${safe}.md`), body.slice(0, 8000));
}
