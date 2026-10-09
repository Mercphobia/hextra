import { loadConfig } from "@hextra/core/config.js";
import { runAgentLoop } from "@hextra/core/agent-loop.js";
import { buildSystemPrompt } from "@hextra/core/prompt-builder.js";
import { handlers, listSchemas } from "@hextra/tools/registry.js";
import { decide, loadPolicy } from "@hextra/tools/permissions.js";
import { recallMemory, saveMemory } from "@hextra/memory/db.js";
import { loadSkills } from "@hextra/memory/skills.js";
import { audit } from "@hextra/core/audit.js";
import { clampInput } from "@hextra/core/secrets.js";
import type { ChatMessage } from "@hextra/core/llm/openai-client.js";
import { wireTools } from "@hextra/tools/wiring.js";

/**
 * Native OpenTUI spike (ANDROIDTUI fork) for Termux.
 * Imperative core API only — no React needed here.
 * Runtime-verification must happen inside Termux; this machine is glibc proot.
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
  const lines: string[] = ["hextra native — /quit to exit. Risky tools are denied here."];
  const renderer = await core.createCliRenderer();
  const root = renderer.root;
  const layout = new core.BoxRenderable(renderer as never, { flexDirection: "column" } as never);
  const logBox = new core.BoxRenderable(renderer as never, { flexDirection: "column" } as never);
  const input = new core.InputRenderable(renderer as never, { placeholder: "type a message…" } as never);
  const painted: import("@androidtui/core").BaseRenderable[] = [];
  root.add(layout);
  layout.add(logBox);
  layout.add(input);

  const paint = (status: string) => {
    for (const child of painted) logBox.remove(child);
    painted.length = 0;
    for (const l of lines.slice(-24)) {
      const t = new core.TextRenderable(renderer as never, { content: l } as never);
      painted.push(t);
      logBox.add(t);
    }
    const s = new core.TextRenderable(renderer as never, { content: `— ${cfg.model} · ${status}` } as never);
    painted.push(s);
    logBox.add(s);
  };
  paint("idle");
  input.focus();

  let busy = false;
  const submit = async (raw: string) => {
    const text = raw.trim();
    input.value = "";
    if (!text || busy) return;
    if (text === "/quit" || text === "/exit") {
      renderer.destroy();
      process.exit(0);
    }
    if (text === "/new") {
      history.length = 0;
      lines.length = 0;
      paint("idle");
      return;
    }
    if (text.startsWith("/")) {
      lines.push(`· unknown command: ${text}`);
      paint("idle");
      return;
    }
    const { text: clamped, truncated } = clampInput(text);
    if (truncated) lines.push("· (input clamped to 20000 chars)");
    lines.push(`> ${clamped}`);
    paint("thinking…");
    busy = true;
    try {
      let draft = "";
      const out = await runAgentLoop({
        cfg,
        system: buildSystemPrompt({ skills: loadSkills(), memory: recallMemory("project", 5) }),
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
          lines.push(`· [denied in native tui] ${tool} needs approval`);
          audit({ tool, args, phase: "denied" });
          return false;
        },
        onToken: (t: string) => {
          draft += t;
        },
        onTool: (name: string, phase: "start" | "done" | "denied", ms?: number) => {
          paint(phase === "start" ? `[tool ${name}] running…` : phase === "done" ? `[tool ${name}] done ${ms}ms` : `[tool ${name}] denied`);
        },
      });
      lines.push(`◆ ${out}`);
      history.push(
        ...[{ role: "user", content: clamped } as ChatMessage, { role: "assistant", content: out } as ChatMessage].slice(-20),
      );
      while (history.length > 20) history.shift();
      saveMemory(`Q: ${clamped.slice(0, 200)}\nA: ${out.slice(0, 400)}`);
      paint("idle");
    } catch (e) {
      lines.push(`· error: ${e instanceof Error ? e.message : String(e)}`);
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
}
