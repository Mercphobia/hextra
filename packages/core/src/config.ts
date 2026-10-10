import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";

/** Approval strictness. strict asks per risky tool; auto allows everything
 *  except the deny list (yolo mode). */
export type ApprovalMode = "strict" | "auto";

export interface McpServerConfig {  name: string;
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
  /** Extra readable/writable roots beyond workspace (e.g. Termux home, sdcard). */
  allowedRoots?: string[];
  /** Max tool iterations per turn. Default 50. Set 0 for unlimited (watch your quota). */
  maxIterations?: number;  theme: "dark" | "light";  autoSkill: boolean;
  approval?: ApprovalMode;
  mcpServers?: McpServerConfig[];
  /** Consumed by the messaging gateway. */
  telegramBotToken?: string;
  discordBotToken?: string;
  allowedTelegramIds?: number[];
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

export interface HextraTheme {
  user?: string;
  ai?: string;
  sys?: string;
  accent?: string;
  success?: string;
  warning?: string;
  error?: string;
  panelBg?: string;
}

export function themePath(): string {
  return join(configDir(), "theme.json");
}

/** Theme overrides, empty when absent or corrupt. */
export function loadTheme(): HextraTheme {
  try {
    if (existsSync(themePath())) return JSON.parse(readFileSync(themePath(), "utf8")) as HextraTheme;
  } catch { /* defaults */ }
  return {};
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
