import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config.js";

export interface BotProfile {
  name: string;
  model?: string;
  system?: string;
  created: string;
}

function path(): string {
  mkdirSync(configDir(), { recursive: true });
  return join(configDir(), "bots.json");
}

export function loadBots(): BotProfile[] {
  try {
    if (existsSync(path())) return JSON.parse(readFileSync(path(), "utf8")) as BotProfile[];
  } catch { /* start empty */ }
  return [];
}

export function saveBots(bots: BotProfile[]): void {
  writeFileSync(path(), JSON.stringify(bots, null, 2));
}

export function addBot(name: string, opts: { model?: string; system?: string } = {}): BotProfile {
  if (!/^[a-z0-9-_]{1,32}$/i.test(name)) throw new Error("bad bot name (a-z 0-9 - _)");
  const bots = loadBots();
  if (bots.some((b) => b.name === name)) throw new Error(`bot '${name}' exists`);
  const bot: BotProfile = { name, ...opts, created: new Date().toISOString() };
  bots.push(bot);
  saveBots(bots);
  return bot;
}

export function removeBot(name: string): boolean {
  const bots = loadBots();
  const kept = bots.filter((b) => b.name !== name);
  if (kept.length === bots.length) return false;
  saveBots(kept);
  return true;
}

export function getBot(name: string): BotProfile | undefined {
  return loadBots().find((b) => b.name === name);
}
