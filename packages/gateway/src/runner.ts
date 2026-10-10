import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir, loadConfig, saveConfig, type HextraConfig } from "@hextra/core/config.js";
import { runAgentLoop } from "@hextra/core/agent-loop.js";
import { buildSystemPrompt } from "@hextra/core/prompt-builder.js";
import { loadSession, newSession, saveSession } from "@hextra/core/sessions.js";
import { handlers, listSchemas, registerTool } from "@hextra/tools/registry.js";
import { connectMcpServers } from "@hextra/tools/mcp.js";
import { decide, loadPolicy } from "@hextra/tools/permissions.js";
import { loadSkills } from "@hextra/memory/skills.js";
import { recallMemory, saveMemory } from "@hextra/memory/db.js";
import { wireTools } from "@hextra/tools/wiring.js";
import { getUpdates, parseCommand, sendMessage, sendTyping } from "./telegram.js";

function chatsPath(): string {
  mkdirSync(configDir(), { recursive: true });
  return join(configDir(), "telegram.json");
}

function loadChats(): Record<string, string> {
  try {
    if (existsSync(chatsPath())) return JSON.parse(readFileSync(chatsPath(), "utf8")) as Record<string, string>;
  } catch { /* start fresh */ }
  return {};
}

function saveChats(m: Record<string, string>): void {
  writeFileSync(chatsPath(), JSON.stringify(m, null, 2));
}

export function isAllowed(cfg: HextraConfig, userId: number): boolean {
  return (cfg.allowedTelegramIds ?? []).includes(userId);
}

export function allowUser(cfg: HextraConfig, userId: number): HextraConfig {
  const ids = new Set(cfg.allowedTelegramIds ?? []);
  ids.add(userId);
  return { ...cfg, allowedTelegramIds: [...ids] };
}

async function handleTurn(cfg: HextraConfig, chatId: number, sessionId: string, input: string, token: string): Promise<void> {
  const chats = loadChats();
  const policy = loadPolicy();
  let session = loadSession(sessionId) ?? newSession(cfg.model);
  await sendTyping(token, chatId);
  try {
    const out = await runAgentLoop({
      cfg,
      system: buildSystemPrompt({ skills: loadSkills(), memory: recallMemory("project", 5) }),
      input,
      history: session.history,
      tools: listSchemas(),
      handlers: handlers(),
      approve: async (tool: string) => decide(policy, new Set(), tool) === "allow",
    });
    session.history = [...session.history.slice(-18), { role: "user", content: input }, { role: "assistant", content: out }];
    session.model = cfg.model;
    saveSession(session);
    chats[String(chatId)] = session.id;
    saveChats(chats);
    saveMemory(`Q: ${input.slice(0, 200)}\nA: ${out.slice(0, 400)}`);
    await sendMessage(token, chatId, out || "(empty)");
  } catch (e) {
    await sendMessage(token, chatId, `error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Long-poll Telegram and serve agent turns. Stops on SIGINT/SIGTERM. */
export async function runTelegramGateway(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg?.telegramBotToken) {
    console.log("No telegramBotToken. Run 'hextra setup' step 6 first.");
    return;
  }
  const token = cfg.telegramBotToken;
  wireTools(cfg.workspace);
  try {
    const mcp = await connectMcpServers(cfg.mcpServers ?? []);
    for (const s of mcp.schemas) registerTool(s.function.name, s.function.description, s.function.parameters, mcp.handlers[s.function.name]);
    mcp.clients.forEach((c) => process.on("exit", () => c.stop()));
    for (const w of mcp.warnings) console.log(`mcp warn: ${w}`);
  } catch (e) {
    console.log(`mcp skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
  let stop = false;
  process.on("SIGINT", () => { stop = true; });
  process.on("SIGTERM", () => { stop = true; });
  let offset = 0;
  console.log(`telegram gateway on (allowlist: ${(cfg.allowedTelegramIds ?? []).join(",") || "empty — send any message to log your id, then 'hextra gateway allow <id>'"})`);
  for (;;) {
    if (stop) {
      console.log("gateway stopped");
      return;
    }
    let updates;
    try {
      updates = await getUpdates(token, offset);
    } catch (e) {
      console.log(`poll error: ${e instanceof Error ? e.message : String(e)}`);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    for (const u of updates) {
      offset = Math.max(offset, u.update_id + 1);
      const msg = u.message;
      if (!msg?.text) continue;
      const userId = msg.from?.id ?? 0;
      const fresh = loadConfig();
      const live = fresh ?? cfg;
      if (!isAllowed(live, userId)) {
        console.log(`unauthorized telegram user ${userId} in chat ${msg.chat.id}`);
        await sendMessage(token, msg.chat.id, `not authorized (your id: ${userId}). Ask the owner to run: hextra gateway allow ${userId}`);
        continue;
      }
      const parsed = parseCommand(msg.text);
      const chats = loadChats();
      if (parsed) {
        const id = chats[String(msg.chat.id)];
        const session = id ? loadSession(id) : null;
        switch (parsed.cmd) {
          case "new":
          case "reset": {
            const s = newSession(live.model);
            saveSession(s);
            chats[String(msg.chat.id)] = s.id;
            saveChats(chats);
            await sendMessage(token, msg.chat.id, `fresh session ${s.id}`);
            break;
          }
          case "model":
            if (parsed.arg) {
              const next = { ...live, model: parsed.arg };
              saveConfig(next);
              await sendMessage(token, msg.chat.id, `model -> ${parsed.arg}`);
            } else {
              await sendMessage(token, msg.chat.id, `model: ${live.model}`);
            }
            break;
          case "usage": {
            const chars = (session?.history ?? []).reduce((n, m) => n + m.content.length, 0);
            await sendMessage(token, msg.chat.id, `~${Math.round(chars / 4)} tokens in session history`);
            break;
          }
          default:
            await sendMessage(token, msg.chat.id, "commands: /new /model <name> /usage, or just chat");
        }
        continue;
      }
      const chatsNow = loadChats();
      let session = chatsNow[String(msg.chat.id)] ? loadSession(chatsNow[String(msg.chat.id)]) : null;
      if (!session) {
        session = newSession(live.model);
        saveSession(session);
        chatsNow[String(msg.chat.id)] = session.id;
        saveChats(chatsNow);
      }
      await handleTurn(live, msg.chat.id, session.id, msg.text, token);
    }
  }
}
