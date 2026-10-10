/** @jsxImportSource @androidtui/solid */
import { createSignal } from "solid-js";
import { render, useKeyboard } from "@androidtui/solid";
import { createCliRenderer } from "@opentui/core";
import { loadConfig, saveConfig, type HextraConfig } from "@hextra/core/config.js";
import { getBot, loadBots, type BotProfile } from "@hextra/core/bots.js";
import { listModels } from "@hextra/core/llm/openai-client.js";
import { runShell } from "@hextra/tools/shell.js";
import { loadThemeTokens } from "./theme.js";
import { createSessionStore } from "./adapters/session.js";
import { saveSession } from "@hextra/core/sessions.js";
import { createChat, type TranscriptItem } from "./adapters/chat.js";
import { createLeader, matchBind, Binds } from "./adapters/keybinds.js";
import { Prompt } from "./components/prompt.js";
import { execFileSync } from "node:child_process";

const SLASH = ["/new", "/sessions", "/resume", "/rm", "/yolo", "/model", "/models", "/skills", "/usage", "/undo", "/compress", "/expand", "/bot", "/help", "/quit"];

function ToolRow({ item, theme }: { item: Extract<TranscriptItem, { kind: "tool" }>; theme: ReturnType<typeof loadThemeTokens> }) {
  const color = item.status === "done" ? theme.success : item.status === "denied" ? theme.error : theme.warning;
  const tail = item.status === "running" ? "…" : item.status === "denied" ? "denied" : `${item.ms}ms`;
  return (
    <box flexDirection="column" paddingLeft={1}>
      <text fg={color}>◈ {item.name} · {tail}</text>
      {item.status === "done" && item.result ? (
        <text fg={theme.textMuted}>{item.result.split("\n").slice(0, 6).join("\n").slice(0, 600)}</text>
      ) : null}
    </box>
  );
}

function Root(props: { cfg: HextraConfig; onExit: () => void }) {
  const { cfg } = props;
  const theme = loadThemeTokens();
  const sessions = createSessionStore(cfg.model);
  const [chat, setChat] = createSignal<ReturnType<typeof createChat> | null>(null);
  const [activeBot, setActiveBot] = createSignal<BotProfile | null>(null);
  const [yolo, setYolo] = createSignal(process.argv.includes("--yolo") || cfg.approval === "auto");
  const [clearKey, setClearKey] = createSignal(0);
  const [pending, setPending] = createSignal<{ tool: string; args: string } | null>(null);
  const [askQ, setAskQ] = createSignal<{ question: string; options: string[] } | null>(null);
  const [picker, setPicker] = createSignal<{ title: string; options: { name: string; description: string }[]; resolve: (i: number) => void } | null>(null);
  const approveRef: { current: ((v: "once" | "always" | "deny") => void) | null } = { current: null };
  const askRef: { current: ((v: string) => void) | null } = { current: null };
  const leader = createLeader();
  const branch = (() => {
    try {
      return execFileSync("git", ["-C", cfg.workspace, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  })();
  const cwdName = cfg.workspace.split("/").filter(Boolean).pop() ?? "~";

  if (!sessions.active()) sessions.create();

  const activeChat = () => {
    let c = chat();
    if (!c) {
      const session = sessions.active() ?? sessions.create();
      c = createChat(cfg, session, {
        onApprove: (req) => new Promise((resolve) => {
          approveRef.current = resolve;
          setPending({ tool: req.tool, args: req.args });
        }),
        onAsk: (question, options) => new Promise((resolve) => {
          askRef.current = resolve;
          setAskQ({ question, options });
        }),
      }, { yolo: () => yolo() });
      void c.init();
      setChat(c);
    }
    return c;
  };

  const answerPending = (v: "once" | "always" | "deny") => {
    const r = approveRef.current;
    approveRef.current = null;
    setPending(null);
    r?.(v);
  };

  const answerAsk = (text: string) => {
    const r = askRef.current;
    askRef.current = null;
    const q = askQ();
    setAskQ(null);
    if (!q || !r) return;
    const n = Number.parseInt(text, 10);
    r(q.options.length && Number.isFinite(n) && n >= 1 && n <= q.options.length ? q.options[n - 1] : text || "no answer");
  };

  const submit = async (raw: string) => {
    const input = raw.trim();
    setClearKey((k) => k + 1);
    if (!input) return;
    if (pending()) {
      const t = input.toLowerCase();
      answerPending(t === "w" || t === "always" ? "always" : t === "d" || t === "deny" ? "deny" : "once");
      return;
    }
    if (askQ()) {
      answerAsk(input);
      return;
    }
    const c = activeChat();
    if (input === "/quit" || input === "/exit") {
      props.onExit();
      return;
    }
    if (input === "/new") {
      sessions.create(activeBot()?.name);
      setChat(null);
      return;
    }
    if (input === "/sessions") {
      const all = sessions.sessions();
      if (!all.length) {
        c.push({ kind: "msg", who: "sys", text: "(no sessions)" });
        return;
      }
      setPicker({
        title: "Sessions (Esc cancels)",
        options: all.map((s) => ({ name: s.title || s.id, description: `${s.id.slice(0, 8)} · ${s.updated.slice(0, 10)}` })),
        resolve: (idx: number) => {
          setPicker(null);
          if (idx < 0 || idx >= all.length) return;
          const loaded = sessions.resume(all[idx].id);
          if (loaded) {
            setChat(null);
            c.push({ kind: "msg", who: "sys", text: `resumed ${loaded.id} :: ${loaded.title}` });
          }
        },
      });
      return;
    }
    if (input === "/help") {
      c.push({ kind: "msg", who: "sys", text: "/new /sessions /resume /rm /yolo /model <name> /models /skills /usage /undo /compress /expand /bot <name> /!cmd /help /quit · leader ctrl+x" });
      return;
    }
    if (input === "/yolo") {
      const next = !yolo();
      setYolo(next);
      if (next) saveConfig({ ...cfg, approval: "auto" });
      c.push({ kind: "msg", who: "sys", text: `yolo ${next ? "ON" : "OFF"}` });
      return;
    }
    if (input === "/skills") {
      const { listSkills } = await import("@hextra/memory/skills.js");
      c.push({ kind: "msg", who: "sys", text: listSkills().join("\n") || "(no skills)" });
      return;
    }
    if (input === "/usage") {
      const chars = c.history.reduce((n, m) => n + m.content.length, 0);
      c.push({ kind: "msg", who: "sys", text: `~${Math.round(chars / 4)} tokens in session history` });
      return;
    }
    if (input === "/undo") {
      c.history.splice(Math.max(0, c.history.length - 2));
      c.session.history = [...c.history];
      saveSession(c.session);
      c.push({ kind: "msg", who: "sys", text: "(last turn dropped)" });
      return;
    }
    if (input === "/compress") {
      const { compressHistory } = await import("@hextra/core/agent-loop.js");
      try {
        const turnCfg = { ...cfg, model: activeBot()?.model ?? cfg.model };
        const compressed = await compressHistory(turnCfg, c.history);
        c.history.length = 0;
        c.history.push(...compressed);
        c.session.history = [...c.history];
        saveSession(c.session);
        c.push({ kind: "msg", who: "sys", text: "(session compressed)" });
      } catch (e) {
        c.push({ kind: "msg", who: "sys", text: `compress failed: ${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }
    if (input === "/expand") {
      c.push({ kind: "msg", who: "sys", text: "tool output already shown inline" });
      return;
    }
    if (input.startsWith("/resume ")) {
      const hit = sessions.sessions().find((s) => s.id.startsWith(input.slice(8).trim()));
      const loaded = hit ? sessions.resume(hit.id) : null;
      if (!loaded) {
        c.push({ kind: "msg", who: "sys", text: "no such session" });
        return;
      }
      setChat(null);
      c.push({ kind: "msg", who: "sys", text: `resumed ${loaded.id} :: ${loaded.title}` });
      return;
    }
    if (input.startsWith("/rm ")) {
      const hit = sessions.sessions().find((s) => s.id.startsWith(input.slice(4).trim()));
      c.push({ kind: "msg", who: "sys", text: hit && sessions.remove(hit.id) ? "removed" : "no such session" });
      return;
    }
    if (input.startsWith("/model ")) {
      cfg.model = input.slice(7).trim();
      saveConfig(cfg);
      c.push({ kind: "msg", who: "sys", text: `model -> ${cfg.model}` });
      return;
    }
    if (input === "/models") {
      try {
        const models = await listModels({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model });
        if (!models.length) {
          c.push({ kind: "msg", who: "sys", text: "(no models listed)" });
          return;
        }
        setPicker({
          title: "Pick a model (Esc cancels)",
          options: models.map((m) => ({ name: m, description: m === cfg.model ? "current" : "" })),
          resolve: (idx: number) => {
            setPicker(null);
            if (idx >= 0 && idx < models.length) {
              cfg.model = models[idx];
              saveConfig(cfg);
              c.push({ kind: "msg", who: "sys", text: `model -> ${cfg.model}` });
            }
          },
        });
      } catch (e) {
        c.push({ kind: "msg", who: "sys", text: `models failed: ${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }
    if (input === "/bot" || input.startsWith("/bot ")) {
      const name = input.slice(4).trim();
      if (!name) {
        c.push({ kind: "msg", who: "sys", text: loadBots().map((b) => b.name).join(" ") || "(no bots)" });
        return;
      }
      const bot = getBot(name);
      if (!bot) {
        c.push({ kind: "msg", who: "sys", text: `no bot '${name}'` });
        return;
      }
      setActiveBot(bot);
      sessions.create(bot.name);
      setChat(null);
      c.push({ kind: "msg", who: "sys", text: `bot -> ${bot.name}` });
      return;
    }
    if (input.startsWith("/")) {
      c.push({ kind: "msg", who: "sys", text: `unknown command: ${input}` });
      return;
    }
    if (input.startsWith("!")) {
      const cmd = input.slice(1).trim();
      if (cmd) {
        c.push({ kind: "msg", who: "you", text: input });
        try {
          const { runShell } = await import("@hextra/tools/shell.js");
          const out = await runShell(cfg.workspace, cmd);
          c.push({ kind: "msg", who: "sys", text: out.slice(0, 3000) });
        } catch (e) {
          c.push({ kind: "msg", who: "sys", text: `shell failed: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
      return;
    }
    await c.send(input, activeBot()?.model, activeBot()?.system, activeBot()?.name ?? "");
  };

  useKeyboard((k) => {
    if (k.name === "escape" && picker()) {
      const p = picker();
      setPicker(null);
      p?.resolve(-1);
      return;
    }
    if (leader.feed(k) === "leader") return;
    const armed = leader.consume();
    if (matchBind(k, Binds.sessionNew, armed)) {
      sessions.create(activeBot()?.name ?? undefined);
      setChat(null);
    } else if (matchBind(k, Binds.sessionList, armed)) {
      void submit("/sessions");
    } else if (matchBind(k, Binds.modelList, armed)) {
      void submit("/models");
    }
  });

  const st = () => chat()?.status() ?? "idle";

  return (
    <box flexDirection="column" padding={1}>
      <text fg={theme.sys}>{cwdName}{branch ? ` ⎇${branch}` : ""} · {activeBot() ? `${activeBot()!.name}@` : ""}{cfg.model} · {st()}{yolo() ? " · YOLO" : ""}</text>
      <scrollbox stickyScroll stickyStart="bottom">
        {(chat()?.items() ?? []).map((m, i) => m.kind === "tool" ? (
          <ToolRow item={m} theme={theme} />
        ) : m.who === "ai" ? (
          <box flexDirection="column"><text>◆ </text><text>{m.text}</text></box>
        ) : (
          <text fg={m.who === "you" ? theme.user : theme.sys}>{m.who === "you" ? "> " : "· "}{m.text}</text>
        ))}
        {chat() && chat()!.reasoning() ? <text fg={theme.sys}>∴ {chat()!.reasoning()}</text> : null}
        {chat() && chat()!.draft() ? <text>{chat()!.draft()}</text> : null}
      </scrollbox>
      {pending() ? (
        <box flexDirection="column" paddingX={1} backgroundColor={theme.backgroundPanel}>
          <text fg={theme.warning}>Permission needed: {pending()!.tool}</text>
          <text fg={theme.sys}>{pending()!.args.slice(0, 200)}</text>
          <text fg={theme.sys}>answer here, or pick: (a)llow · al(w)ays · (d)eny</text>
          <select focused options={[
            { name: "Allow once", description: "this call" },
            { name: "Allow always", description: "remember" },
            { name: "Deny", description: "block" },
          ]} onSelect={(idx) => answerPending(idx === 1 ? "always" : idx === 2 ? "deny" : "once")} />
        </box>
      ) : null}
      {askQ() ? (
        <box flexDirection="column" paddingX={1} backgroundColor={theme.backgroundPanel}>
          <text fg={theme.accent}>? {askQ()!.question}</text>
          {askQ()!.options.map((o, i) => <text fg={theme.sys}>{i + 1}. {o}</text>)}
          <text fg={theme.sys}>number or your own answer</text>
        </box>
      ) : null}
      {picker() ? (
        <box flexDirection="column" paddingX={1} backgroundColor={theme.backgroundPanel}>
          <text><b>{picker()!.title}</b></text>
          <select focused options={picker()!.options} onSelect={(idx) => {
            const r = picker();
            setPicker(null);
            r?.resolve(idx);
          }} />
        </box>
      ) : null}
      <Prompt
        workspace={cfg.workspace}
        first={sessions.sessions().length === 0}
        bots={loadBots().map((b) => b.name)}
        commands={SLASH}
        accent={theme.accent}
        muted={theme.textMuted}
        border={theme.border}
        focused={!picker()}
        onSubmit={(v) => void submit(v)}
      />
      <box paddingX={1}>
        <text fg={theme.sys}>{cfg.model} · {st()}{yolo() ? " · YOLO" : ""}</text>
      </box>
    </box>
  );
}

export async function runNativeTui(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) {
    console.log("No config. Run 'hextra setup' first.");
    return;
  }
  const renderer = await createCliRenderer();
  await new Promise<void>((resolve) => {
    const exit = () => {
      try {
        renderer.destroy();
      } catch {
        /* already gone */
      }
      resolve();
    };
    process.on("SIGINT", exit);
    void render(() => <Root cfg={cfg} onExit={exit} />, renderer);
  });
}
