import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  /** Tool allowlist. Undefined = all tools (runtime approval still asks). */
  allow?: string[];
}

export interface HextraConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackBaseUrl?: string;
  fallbackModel?: string;
  workspace: string;
  theme: "dark" | "light";
  autoSkill: boolean;
  mcpServers?: McpServerConfig[];
}

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export function configDir(): string {
  return process.env.HEXTRA_HOME ?? join(homedir(), ".config", "hextra");
}

export function dataDir(): string {
  return join(homedir(), ".local", "share", "hextra");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function defaultWorkspace(): string {
  return join(homedir(), "hextra-workspace");
}

export function loadConfig(): HextraConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as HextraConfig;
}

export function saveConfig(cfg: HextraConfig): void {
  mkdirSync(configDir(), { recursive: true });
  mkdirSync(dataDir(), { recursive: true });
  mkdirSync(cfg.workspace, { recursive: true });
  writeFileSync(configPath(), JSON.stringify({ ...cfg, apiKey: cfg.apiKey }, null, 2), { mode: 0o600 });
  try {
    chmodSync(configPath(), 0o600);
  } catch { /* Termux-safe ignore */ }
}
