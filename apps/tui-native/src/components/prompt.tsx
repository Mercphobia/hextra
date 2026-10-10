/** @jsxImportSource @androidtui/solid */
import { createMemo, createSignal } from "solid-js";
import { globFiles } from "@hextra/tools/glob.js";

export interface PromptMenu {
  kind: "/" | "@";
  query: string;
  index: number;
  options: { label: string; hint: string; insert: string }[];
}

interface TextArea {
  plainText: string;
  isDestroyed?: boolean;
  clear?: () => void;
}

let pollStarted = false;

/**
 * Prompt box ported from opencode (packages/tui/src/component/prompt/index.tsx
 * + footer.prompt.tsx RunPromptBody): left-border box, multiline textarea,
 * / and @ filter menus, ! shell mode, guarded submit.
 *
 * Fork realities (see DEVIATIONS.md): textarea key events and custom
 * keyBindings are unreliable on this runtime, so Enter inserts a newline and
 * sending is a trailing blank line (like mobile chat apps). Menu items are
 * accepted by number. History navigation is unavailable without key events.
 */
export function Prompt(props: {
  workspace: string;
  first: boolean;
  bots: string[];
  commands: string[];
  accent: string;
  muted: string;
  border: string;
  focused: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = createSignal("");
  const [menu, setMenu] = createSignal<PromptMenu | null>(null);
  let area: TextArea | undefined;
  let submitting = false;

  const shell = createMemo(() => value().startsWith("!"));
  const placeholder = createMemo(() => {
    if (shell()) return 'Run a command... "git status"';
    if (props.first) return 'Ask anything... "Fix a TODO in the codebase"';
    return "blank line sends";
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

  const doSubmit = (text: string) => {
    if (submitting) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    submitting = true;
    try {
      try {
        area?.clear?.();
      } catch {
        /* buffer keeps text; remount clears */
      }
      setValue("");
      setMenu(null);
      props.onSubmit(trimmed);
    } finally {
      submitting = false;
    }
  };

  const submitNow = () => {
    // Native submit action (if the runtime fires it).
    const live = area && !area.isDestroyed ? area.plainText : value();
    tryAcceptOrSend(live);
  };

  const tryAcceptOrSend = (live: string) => {
    const m = menu();
    if (m) {
      const n = Number.parseInt(live.trim(), 10);
      if (Number.isFinite(n) && m.options[n - 1]) {
        const lines = live.split("\n");
        const last = lines.length - 1;
        lines[last] = lines[last].replace(/[/@][\w./-]*$/, m.options[n - 1].insert);
        setValue(lines.join("\n"));
        setMenu(null);
        return;
      }
      setMenu(null);
      return;
    }
    const text = live.replace(/\n+$/, "");
    if (text.trim()) doSubmit(text);
  };

  if (!pollStarted) {
    pollStarted = true;
    setInterval(() => {
      if (submitting) return;
      try {
        const live = area && !area.isDestroyed ? area.plainText : "";
        if (live.endsWith("\n\n")) tryAcceptOrSend(live);
      } catch {
        /* renderer gone */
      }
    }, 250);
  }

  return (
    <box flexDirection="column">
      {menu() && menu()!.options.length ? (
        <box flexDirection="column" paddingX={2}>
          {menu()!.options.slice(0, 8).map((o, i) => (
            <text fg={props.muted}>
              {i + 1}. {o.label}{o.hint ? `  ${o.hint}` : ""}
            </text>
          ))}
        </box>
      ) : null}
      <box border={["left"]} borderColor={shell() ? props.accent : props.border} paddingLeft={2} paddingRight={2} paddingTop={1}>
        <textarea
          ref={(r: unknown) => {
            area = r as TextArea | undefined;
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
          onSubmit={submitNow}
        />
      </box>
    </box>
  );
}
