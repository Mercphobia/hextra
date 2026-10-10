import { loadTheme } from "@hextra/core/config.js";

/**
 * Single source of colors. Token names mirror opencode's Theme where they
 * apply (see DESIGN_SPEC.md section 2); values come from theme.json
 * overrides, falling back to opencode's dark fallback palette
 * (RUN_THEME_FALLBACK in the ref source).
 */
export interface ThemeTokens {
  text: string;
  textMuted: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  backgroundPanel: string;
  border: string;
  user: string;
  ai: string;
  sys: string;
  diffAdded: string;
  diffRemoved: string;
  code: string;
}

const DARK_DEFAULTS: ThemeTokens = {
  text: "#f8fafc",
  textMuted: "#64748b",
  accent: "#38bdf8",
  error: "#ef4444",
  warning: "#f59e0b",
  success: "#22c55e",
  info: "#38bdf8",
  backgroundPanel: "#0f172a",
  border: "#334155",
  user: "#f8fafc",
  ai: "#f8fafc",
  sys: "#64748b",
  diffAdded: "#22c55e",
  diffRemoved: "#ef4444",
  code: "#38bdf8",
};

/** theme.json may use our legacy keys (user/ai/sys/accent/panelBg) or
 *  opencode token names; both are honored, explicit tokens win. */
export function loadThemeTokens(): ThemeTokens {
  const raw = loadTheme() as Record<string, string | undefined>;
  return {
    text: raw.text ?? DARK_DEFAULTS.text,
    textMuted: raw.textMuted ?? raw.sys ?? DARK_DEFAULTS.textMuted,
    accent: raw.accent ?? DARK_DEFAULTS.accent,
    error: raw.error ?? DARK_DEFAULTS.error,
    warning: raw.warning ?? DARK_DEFAULTS.warning,
    success: raw.success ?? DARK_DEFAULTS.success,
    info: raw.info ?? DARK_DEFAULTS.info,
    backgroundPanel: raw.backgroundPanel ?? raw.panelBg ?? DARK_DEFAULTS.backgroundPanel,
    border: raw.border ?? DARK_DEFAULTS.border,
    user: raw.user ?? DARK_DEFAULTS.user,
    ai: raw.ai ?? DARK_DEFAULTS.ai,
    sys: raw.sys ?? DARK_DEFAULTS.sys,
    diffAdded: raw.diffAdded ?? DARK_DEFAULTS.diffAdded,
    diffRemoved: raw.diffRemoved ?? DARK_DEFAULTS.diffRemoved,
    code: raw.code ?? DARK_DEFAULTS.code,
  };
}
