import { loadConfig, saveConfig } from "@hextra/core/config.js";
import { runAgentLoop, compressHistory } from "@hextra/core/agent-loop.js";
import { getBot, loadBots, type BotProfile } from "@hextra/core/bots.js";
import { buildSystemPrompt } from "@hextra/core/prompt-builder.js";
import { handlers, listSchemas } from "@hextra/tools/registry.js";
import { decide, loadPolicy, savePolicy, parseApprovalAnswer } from "@hextra/tools/permissions.js";
import { recallMemory, saveMemory } from "@hextra/memory/db.js";
import { listSkills, loadSkills, saveSkill } from "@hextra/memory/skills.js";
import { audit } from "@hextra/core/audit.js";
import { clampInput, redactSecrets } from "@hextra/core/secrets.js";
import { renderDiff } from "@hextra/tools/diff.js";
import { tokenizeMarkdown } from "@hextra/tools/markdown.js";
import type { ChatMessage } from "@hextra/core/llm/openai-client.js";
import { wireTools } from "@hextra/tools/wiring.js";

type Item =
  | { kind: "msg"; who: "you" | "ai" | "sys"; text: string }
  | { kind: "tool"; callId: string; name: string; args: string; status: "running" | "done" | "denied"; ms?: number; result?: string };

function toolSummary(name: string, args: string): string {
  try {
    const o = JSON.parse(args) as Record<string, unknown>;
    return String(o.path ?? o.command ?? o.pattern ?? o.url ?? o.query ?? "").slice(0, 60);
  } catch {
    return "";
  }
}

/**
 * Native OpenTUI renderer (ANDROIDTUI fork) with OpenCode-style transcript:
 * bordered tool blocks, inline diffs, approval box, markdown code boxes.
 * Termux-only; needs the Bionic .so (see scripts/androidtui-alias.mjs).
 */
export async function runNativeTui(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) {
    console.log("No config. Run 'hextra setup' first.");
    return;
  }
  let core: typeof import("@androidtui/core");
  try {
    core = await import("@androidtui/core");
  } catch (e) {
    console.log(`native TUI unavailable: ${e instanceof Error ? e.message : String(e)}`);
    console.log("Use 'hextra' (readline) or 'hextra tui' (Ink) instead.");
    return;
  }

  wireTools(cfg.workspace);
  const policy = loadPolicy();
  const history: ChatMessage[] = [];
  const items: Item[] = [{ kind: "msg", who: "sys", text: "hextra native — type / for commands." }];
  let activeBot: BotProfile | null = null;
  let tokTotal = 0;
  let busy = false;
  let pending: { tool: string; args: string; resolve: (ok: boolean) => void } | null = null;

  const renderer = await core.createCliRenderer();
  const ctx = renderer as never;
  const layout = new core.BoxRenderable(ctx, { flexDirection: "column" } as never);
  const header = new core.BoxRenderable(ctx, { border: true, title: "hextra" } as never);
  const headerText = new core.TextRenderable(ctx, { content: "" });
  const logBox = new core.BoxRenderable(ctx, { flexDirection: "column" } as never);
  const approvalBox = new core.BoxRenderable(ctx, { border: true, borderColor: "yellow", flexDirection: "column" } as never);
  const hintText = new core.TextRenderable(ctx, { content: "", fg: "gray" } as never);
  const input = new core.InputRenderable(ctx, { placeholder: "type a message… (/ for commands)" } as never);
  const statusText = new core.TextRenderable(ctx, { content: "", fg: "gray" } as never);
  (renderer.root as unknown as { add: (c: unknown) => void }).add(layout);
  layout.add(header);
  header.add(headerText);
  layout.add(logBox);
  layout.add(approvalBox);
  layout.add(hintText);
  layout.add(input);
  layout.add(statusText);

  let painted: import("@androidtui/core").BaseRenderable[] = [];
  const clearBox = (box: { remove: (c: unknown) => void }) => {
    for (const c of painted.splice(0)) box.remove(c);
  };
  let approvalPainted: import("@androidtui/core").BaseRenderable[] = [];
  const clearApproval = () => {
    for (const c of approvalPainted.splice(0)) approvalBox.remove(c);
  };

  const text = (content: string, fg?: string) =>
    new core.TextRenderable(ctx, fg ? ({ content, fg } as never) : ({ content } as never));

  const paint = (status: string) => {
    clearBox(logBox as unknown as { remove: (c: unknown) => void });
    for (const it of items.slice(-30)) {
      if (it.kind === "msg") {
        const fg = it.who === "you" ? "green" : it.who === "ai" ? "white" : "gray";
        const prefix = it.who === "you" ? "> " : it.who === "ai" ? "◆ " : "· ";
        if (it.who === "ai") {
          painted.push(text("◆"));
          logBox.add(painted[painted.length - 1]);
          for (const t of tokenizeMarkdown(it.text)) {
            let node: import("@androidtui/core").BaseRenderable | null = null;
            if (t.kind === "codeblock") {
              const box = new core.BoxRenderable(ctx, { border: true, title: t.lang || "code", flexDirection: "column" } as never);
              const body = new core.TextRenderable(ctx, { content: t.text.split("\n").slice(0, 20).join("\n") });
              (box as unknown as { add: (c: unknown) => void }).add(body);
              node = box;
            } else if (t.kind === "list") {
              node = text(t.items.map((x) => `• ${x}`).join("\n"));
            } else if (t.kind === "bold") {
              node = text(t.text, "white");
            } else if (t.kind === "code") {
              node = text(t.text, "cyan");
            } else if (t.text.trim()) {
              node = text(t.text);
            }
            if (node) {
              painted.push(node);
              logBox.add(node);
            }
          }
          continue;
        }
        const node = text(prefix + it.text, fg);
        painted.push(node);
        logBox.add(node);
      } else {
        const color = it.status === "done" ? "green" : it.status === "denied" ? "red" : "yellow";
        const tail = it.status === "running" ? "…" : it.status === "denied" ? "denied" : `${it.ms}ms`;
        const box = new core.BoxRenderable(ctx, { border: true, borderColor: color, flexDirection: "column" } as never);
        const head = text(`◈ ${it.name} ${toolSummary(it.name, it.args)} · ${tail}`, color);
        (box as unknown as { add: (c: unknown) => void }).add(head);
        if (it.name === "edit_file") {
          try {
            const o = JSON.parse(it.args) as { search?: string; replace?: string };
            if (o.search && o.replace !== undefined) {
              for (const l of renderDiff(o.search, o.replace, 8)) {
                (box as unknown as { add: (c: unknown) => void }).add(
                  text(l, l.startsWith("+") ? "green" : l.startsWith("-") ? "red" : "gray"),
                );
              }
            }
          } catch { /* show header only */ }
        }
        if (it.status === "done" && it.result) {
          (box as unknown as { add: (c: unknown) => void }).add(
            text(redactSecrets(it.result).split("\n").slice(0, 6).join("\n").slice(0, 600), "gray"),
          );
        }
        painted.push(box);
        logBox.add(box);
      }
    }
    clearApproval();
    if (pending) {
      const t = text(`Permission needed: ${pending.tool}`, "yellow");
      const a = text(redactSecrets(pending.args).slice(0, 200), "gray");
      const h = text("(a)llow once · al(w)ays · (d)eny [a]", "yellow");
      approvalPainted.push(t, a, h);
      approvalBox.add(t);
      approvalBox.add(a);
      if (pending.tool === "edit_file") {
        try {
          const o = JSON.parse(pending.args) as { search?: string; replace?: string };
          if (o.search && o.replace !== undefined) {
            for (const l of renderDiff(o.search, o.replace, 8)) {
              const d = text(l, l.startsWith("+") ? "green" : l.startsWith("-") ? "red" : "gray");
              approvalPainted.push(d);
              approvalBox.add(d);
            }
          }
        } catch { /* args only */ }
      }
      approvalBox.add(h);
    }
    headerText.content = `${activeBot ? `${activeBot.name}@` : ""}${cfg.model}`;
    statusText.content = `${cfg.model} · ~${(tokTotal / 1000).toFixed(1)}k · ${status}${pending ? ` · APPROVAL ${pending.tool}` : ""}`;
  };

  const SLASH = ["/new", "/model", "/skills", "/usage", "/undo", "/compress", "/bot", "/help", "/quit"];
  input.on("change", () => {
    const v: string = input.value;
    hintText.content = v.startsWith("/") ? SLASH.filter((c) => c.startsWith(v)).slice(0, 6).join("  ") : "";
  });

  const submit = async (raw: string) => {
    const txt = raw.trim();
    input.value = "";
    hintText.content = "";
    if (pending) {
      const ans = parseApprovalAnswer(txt);
      const p = pending;
      pending = null;
      if (ans === "always") {
        policy.allow.push(p.tool);
        savePolicy(policy);
      }
      items.push({ kind: "msg", who: "sys", text: ans === "deny" ? `[denied] ${p.tool}` : `[allowed] ${p.tool}` });
      paint(busy ? "thinking…" : "idle");
      p.resolve(ans !== "deny");
      return;
    }
    if (!txt || busy) return;
    if (txt === "/quit" || txt === "/exit") {
      renderer.destroy();
      process.exit(0);
    }
    if (txt === "/new") {
      history.length = 0;
      items.length = 0;
      paint("idle");
      return;
    }
    if (txt === "/help") {
      items.push({ kind: "msg", who: "sys", text: "/new /model <name> /skills /usage /undo /compress /bot <name> /help /quit" });
      paint("idle");
      return;
    }
    if (txt === "/skills") {
      items.push({ kind: "msg", who: "sys", text: listSkills().join("\n") || "(no skills)" });
      paint("idle");
      return;
    }
    if (txt === "/usage") {
      const chars = history.reduce((n, m) => n + m.content.length, 0);
      items.push({ kind: "msg", who: "sys", text: `~${Math.round(chars / 4)} tokens in session history` });
      paint("idle");
      return;
    }
    if (txt === "/undo") {
      history.splice(0, Math.max(0, history.length - 2));
      items.push({ kind: "msg", who: "sys", text: "(last turn dropped)" });
      paint("idle");
      return;
    }
    if (txt === "/compress") {
      const turnCfg = activeBot?.model ? { ...cfg, model: activeBot.model } : cfg;
      paint("compressing…");
      try {
        const c = await compressHistory(turnCfg, history);
        history.length = 0;
        history.push(...c);
        items.push({ kind: "msg", who: "sys", text: "(session compressed)" });
      } catch (e) {
        items.push({ kind: "msg", who: "sys", text: `compress failed: ${e instanceof Error ? e.message : String(e)}` });
      }
      paint("idle");
      return;
    }
    if (txt.startsWith("/model ")) {
      cfg.model = txt.slice(7).trim();
      saveConfig(cfg);
      items.push({ kind: "msg", who: "sys", text: `model -> ${cfg.model}` });
      paint("idle");
      return;
    }
    if (txt === "/bot" || txt.startsWith("/bot ")) {
      const name = txt.slice(4).trim();
      if (!name) {
        items.push({ kind: "msg", who: "sys", text: loadBots().map((b) => b.name).join(" ") || "(no bots)" });
        paint("idle");
        return;
      }
      const bot = getBot(name);
      if (!bot) {
        items.push({ kind: "msg", who: "sys", text: `no bot '${name}'` });
        paint("idle");
        return;
      }
      activeBot = bot;
      history.length = 0;
      items.push({ kind: "msg", who: "sys", text: `bot -> ${bot.name}` });
      paint("idle");
      return;
    }
    if (txt.startsWith("/")) {
      items.push({ kind: "msg", who: "sys", text: `unknown command: ${txt}` });
      paint("idle");
      return;
    }
    const { text: clamped, truncated } = clampInput(txt);
    if (truncated) items.push({ kind: "msg", who: "sys", text: "(input clamped to 20000 chars)" });
    items.push({ kind: "msg", who: "you", text: clamped });
    paint("thinking…");
    busy = true;
    let toolsUsed = 0;
    const turnCfg = activeBot?.model ? { ...cfg, model: activeBot.model } : cfg;
    const ns = activeBot?.name ?? "";
    try {
      const out = await runAgentLoop({
        cfg: turnCfg,
        system: buildSystemPrompt({ identity: activeBot?.system, skills: loadSkills(), memory: recallMemory("project", 5, ns) }),
        input: clamped,
        history: [...history],
        tools: listSchemas(),
        handlers: handlers(),
        approve: async (tool: string, args: string) => {
          const d = decide(policy, new Set(), tool);
          if (d === "deny") {
            audit({ tool, args, phase: "denied" });
            return false;
          }
          if (d === "allow") return true;
          paint("waiting approval…");
          return new Promise<boolean>((resolve) => {
            pending = { tool, args, resolve };
          });
        },
        onToken: () => {},
        onTool: (name: string, phase: "start" | "done" | "denied", ms?: number, detail?: { id: string; args: string; result?: string }) => {
          if (phase === "start") {
            toolsUsed++;
            items.push({ kind: "tool", callId: detail?.id ?? "", name, args: detail?.args ?? "", status: "running" });
          } else {
            const it = items.find((x) => x.kind === "tool" && x.callId === detail?.id && x.status === "running");
            if (it && it.kind === "tool") {
              it.status = phase === "done" ? "done" : "denied";
              it.ms = ms;
              it.result = detail?.result;
            }
          }
          paint(phase === "start" ? `[tool ${name}] running…` : phase === "done" ? `[tool ${name}] done ${ms}ms` : `[tool ${name}] denied`);
        },
      });
      items.push({ kind: "msg", who: "ai", text: out });
      history.push(
        { role: "user", content: clamped },
        { role: "assistant", content: out },
      );
      while (history.length > 20) history.shift();
      tokTotal += Math.round((clamped.length + out.length) / 4);
      saveMemory(`Q: ${clamped.slice(0, 200)}\nA: ${out.slice(0, 400)}`, ns);
      if (toolsUsed >= 3 && cfg.autoSkill && !out.startsWith("(stopped")) {
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
        saveSkill(`auto-${stamp}`, `Task: ${clamped.slice(0, 300)}\nResult: ${out.slice(0, 1500)}`);
        items.push({ kind: "msg", who: "sys", text: "(auto-skill saved)" });
      }
      paint("idle");
    } catch (e) {
      items.push({ kind: "msg", who: "sys", text: `error: ${e instanceof Error ? e.message : String(e)}` });
      paint("error");
    } finally {
      busy = false;
      input.focus();
    }
  };

  input.on("enter", () => {
    void submit(input.value);
  });
  process.on("SIGINT", () => {
    renderer.destroy();
    process.exit(0);
  });
  paint("idle");
  input.focus();
}
