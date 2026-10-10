/**
 * Keybind defaults, verbatim from opencode
 * (packages/tui/src/config/keybind.ts in /opencode-ref).
 * Only bindings the TUI port implements are listed; the table grows in Phase 4.
 * Leader default: ctrl+x. Timeout for leader sequences: 1000ms.
 */
export const LEADER = "ctrl+x";
export const LEADER_TIMEOUT_MS = 1000;

export interface KeyPress {
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
  eventType?: string;
}

function normKey(name: string): string {
  const n = name.toLowerCase();
  if (n === "return" || n === "kpenter") return "return";
  if (n === "linefeed") return "linefeed";
  if (n === "backspace") return "backspace";
  if (n === "delete") return "delete";
  if (n === "escape") return "escape";
  if (n === "tab") return "tab";
  if (n === "space") return "space";
  return n;
}

/** Match a keypress against one opencode binding combo like "ctrl+x",
 *  "<leader>m", "shift+tab", "escape", "f2". Leader combos only match when
 *  the leader sequence is armed (see createLeader). */
export function matchCombo(e: KeyPress, combo: string, leaderArmed = false): boolean {
  let rest = combo.toLowerCase();
  let wantLeader = false;
  if (rest.startsWith("<leader>")) {
    wantLeader = true;
    rest = rest.slice("<leader>".length);
  }
  const parts = rest.split("+");
  let wantCtrl = false;
  let wantMeta = false;
  let wantShift = false;
  let wantName = "";
  for (const p of parts) {
    if (p === "ctrl") wantCtrl = true;
    else if (p === "meta" || p === "alt") wantMeta = true;
    else if (p === "shift") wantShift = true;
    else wantName = p.replace(/^<|>$/g, "");
  }
  if (wantLeader && !leaderArmed) return false;
  if (!!e.ctrl !== wantCtrl) return false;
  if (!!e.meta !== wantMeta) return false;
  if (wantShift && !e.shift) return false;
  if (normKey(e.name) !== normKey(wantName)) return false;
  return true;
}

/** True if any combo in a comma list (e.g. "ctrl+c,ctrl+d") matches. */
export function matchBind(e: KeyPress, binding: string, leaderArmed = false): boolean {
  return binding.split(",").some((c) => matchCombo(e, c.trim(), leaderArmed));
}

/** Leader-key sequence tracker: call feed() per keypress; returns true while
 *  armed (leader just pressed) or when a full <leader>x combo completes. */
export function createLeader(timeoutMs = LEADER_TIMEOUT_MS) {
  let armedAt = 0;
  return {
    feed(e: KeyPress): "leader" | null {
      const now = Date.now();
      if (now - armedAt > timeoutMs) armedAt = 0;
      if (matchCombo(e, LEADER)) {
        armedAt = now;
        return "leader";
      }
      return null;
    },
    consume(): boolean {
      const armed = Date.now() - armedAt <= timeoutMs;
      armedAt = 0;
      return armed;
    },
  };
}

export const Binds = {
  appExit: "ctrl+c,ctrl+d",
  sessionNew: "<leader>n",
  sessionList: "<leader>l",
  sessionInterrupt: "escape",
  sessionCompact: "<leader>c",
  sessionBackground: "ctrl+b",
  modelList: "<leader>m",
  commandPalette: "ctrl+p",
  sidebarToggle: "<leader>b",
  promptSubmit: "return",
  promptNewline: "shift+return,ctrl+return,alt+return,ctrl+j",
  historyPrevious: "up",
  historyNext: "down",
} as const;
