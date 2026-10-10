/** @jsxImportSource @androidtui/solid */
import { createMemo, createSignal } from "solid-js";
import { globFiles } from "@hextra/tools/glob.js";

export interface PromptMenu {
  kind: "/" | "@";
  query: string;
  index: number;
  options: { label: string; hint: string; insert: string }[];
}

/**
 * Prompt box ported from opencode (packages/tui/src/component/prompt/index.tsx
 * + footer.prompt.tsx RunPromptBody): left-border box, multiline textarea,
 * / and @ autocomplete menus, history navigation, ! shell mode.
 * Adapted: slash/bot/file sources come from props (our adapters); submit keys
 * follow opencode keybinds (return=submit, shift/ctrl/meta+return=newline).
 */
export function Prompt(props: {
  workspace: string;
  first: boolean;
  bots: string[];
  commands: string[];
  history: string[];
  accent: string;
  muted: string;
  border: string;
  focused: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = createSignal("");
  const [menu, setMenu] = createSignal<PromptMenu | null>(null);
  const [histIdx, setHistIdx] = createSignal(-1);
  const [lastKey, setLastKey] = createSignal("");
  let area: { plainText: string; isDestroyed?: boolean } | undefined;
  let submitting = false;

  const shell = createMemo(() => value().startsWith("!"));
  const placeholder = createMemo(() => {
    if (shell()) return 'Run a command... "git status"';
    if (props.first) return 'Ask anything... "Fix a TODO in the codebase"';
    return "";
  });

  const refreshMenu = (v: string) => {
    const lastLine = v.split("\n").pop() ?? "";
    const slash = lastLine.match(/\/(\w*)$/);
    const at = lastLine.match(/@([\w./-]*)$/);
    if (slash && !shell()) {
      const q = slash[1].toLowerCase();
      const options = props.commands
        .filter((c) => c.toLowerCase().startsWith(`/${q}`))
        .map((c) => ({ label: c, hint: "", insert: c }));
      setMenu({ kind: "/", query: q, index: 0, options });
      return;
    }
    if (at) {
      const q = at[1].toLowerCase();
      const bots = props.bots
        .filter((b) => b.toLowerCase().includes(q))
        .map((b) => ({ label: `@${b}`, hint: "agent", insert: `@${b} ` }));
      let files: { label: string; hint: string; insert: string }[] = [];
      try {
        files = globFiles(props.workspace, `*${at[1]}*`)
          .slice(0, 6)
          .map((f) => ({ label: f, hint: "file", insert: `@${f} ` }));
      } catch {
        files = [];
      }
      setMenu({ kind: "@", query: q, index: 0, options: [...bots, ...files].slice(0, 10) });
      return;
    }
    setMenu(null);
  };

  const acceptIndex = (i: number) => {
    const m = menu();
    if (!m || !m.options.length) return false;
    const opt = m.options[Math.min(Math.max(0, i), m.options.length - 1)];
    const base = area && !area.isDestroyed ? area.plainText : value();
    const lines = base.split("\n");
    const last = lines.length - 1;
    lines[last] = lines[last].replace(/[/@][\w./-]*$/, opt.insert);
    setValue(lines.join("\n"));
    setMenu(null);
    return true;
  };

  const acceptMenu = () => {
    const m = menu();
    if (!m) return false;
    return acceptIndex(m.index);
  };

  const submitNow = () => {
    if (submitting) return;
    // Read the buffer directly: the value signal can lag one edit behind
    // (same race opencode handles by reading input.plainText in submitInner).
    const live = area && !area.isDestroyed ? area.plainText : value();
    const text = live.trim();
    if (!text) return;
    if (menu()) {
      const n = Number.parseInt(text, 10);
      if (Number.isFinite(n) && menu()!.options[n - 1]) {
        acceptIndex(n - 1);
        return;
      }
      setMenu(null);
      return;
    }
    submitting = true;
    try {
      setValue("");
      setMenu(null);
      setHistIdx(-1);
      props.onSubmit(text);
    } finally {
      submitting = false;
    }
  };

  return (
    <box flexDirection="column">
      {menu() && menu()!.options.length ? (
        <box flexDirection="column" paddingX={2}>
          {menu()!.options.slice(0, 8).map((o, i) => (
            <text fg={i === menu()!.index ? props.accent : props.muted}>
              {i === menu()!.index ? "▸ " : "  "}{o.label}{o.hint ? `  ${o.hint}` : ""}
            </text>
          ))}
        </box>
      ) : null}
      <box border={["left"]} borderColor={shell() ? props.accent : props.border} paddingLeft={2} paddingRight={2} paddingTop={1}>
        <text fg={props.muted}>key: {lastKey()}</text>
        <textarea
          ref={(r: unknown) => {
            area = r as { plainText: string; isDestroyed?: boolean } | undefined;
          }}
          width="100%"
          minHeight={1}
          maxHeight={6}
          wrapMode="word"
          focused={props.focused}
          placeholder={placeholder()}
          placeholderColor={props.muted}
          textColor="white"
          onContentChange={(v: unknown) => {
            const s = typeof v === "string" ? v : "";
            setValue(s);
            refreshMenu(s);
          }}
          onKeyDown={(e: { name: string; shift?: boolean; ctrl?: boolean; meta?: boolean; preventDefault?: () => void }) => {
            setLastKey(`${e.name}${e.ctrl ? "+c" : ""}${e.meta ? "+m" : ""}${e.shift ? "+s" : ""}`);
            const m = menu();
            if (m) {
              if (e.name === "up") {
                setMenu({ ...m, index: (m.index - 1 + m.options.length) % Math.max(1, m.options.length) });
                e.preventDefault?.();
                return;
              }
              if (e.name === "down") {
                setMenu({ ...m, index: (m.index + 1) % Math.max(1, m.options.length) });
                e.preventDefault?.();
                return;
              }
              if (e.name === "escape") {
                setMenu(null);
                e.preventDefault?.();
                return;
              }
              if (e.name === "tab" || e.name === "return") {
                if (acceptMenu()) e.preventDefault?.();
                return;
              }
            }
            if (!m && (e.name === "up" || e.name === "down") && !value().includes("\n") && props.history.length) {
              e.preventDefault?.();
              if (e.name === "up") {
                const i = Math.min(histIdx() + 1, props.history.length - 1);
                setHistIdx(i);
                const v = props.history[props.history.length - 1 - i] ?? "";
                setValue(v);
                refreshMenu(v);
              } else {
                if (histIdx() > 0) {
                  const i = histIdx() - 1;
                  setHistIdx(i);
                  const v = props.history[props.history.length - 1 - i] ?? "";
                  setValue(v);
                  refreshMenu(v);
                } else {
                  setHistIdx(-1);
                  setValue("");
                  setMenu(null);
                }
              }
            }
          }}
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "return", shift: true, action: "newline" },
            { name: "return", ctrl: true, action: "newline" },
            { name: "return", meta: true, action: "newline" },
          ]}
          onSubmit={submitNow}
        />
      </box>
    </box>
  );
}
