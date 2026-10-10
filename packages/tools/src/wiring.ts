import { registerTool } from "./registry.js";
import { readFile, grepFiles } from "./fs.js";
import { globFiles } from "./glob.js";
import { editFile } from "./patch.js";
import { runShell } from "./shell.js";
import { webfetch } from "./web.js";
import { writeFile } from "./write.js";
import { recallMemory, saveMemory } from "@hextra/memory/db.js";
import { saveSkill } from "@hextra/memory/skills.js";
import { askUser, setAskHandler } from "./ask.js";

export { setAskHandler };

function arg<T>(json: string, key: string): T {
  return (JSON.parse(json) as Record<string, T>)[key];
}

/** The 10 built-in tools, shared by readline chat, Ink TUI, native TUI, cron, and bots. */
export function wireTools(workspace: string): void {
  registerTool("read_file", "Read a file inside workspace", { type: "object", properties: { path: { type: "string" } } },
    async (a) => readFile(workspace, arg<string>(a, "path")));
  registerTool("write_file", "Write a file inside workspace (asks approval)", { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
    async (a) => writeFile(workspace, arg<string>(a, "path"), arg<string>(a, "content")));
  registerTool("edit_file", "Replace one exact block in a file (asks approval)", { type: "object", properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" } } },
    async (a) => editFile(workspace, arg<string>(a, "path"), arg<string>(a, "search"), arg<string>(a, "replace")));
  registerTool("glob", "List files matching a * pattern", { type: "object", properties: { pattern: { type: "string" } } },
    async (a) => globFiles(workspace, arg<string>(a, "pattern")).join("\n") || "(no matches)");
  registerTool("shell", "Run an allowlisted shell command in workspace (asks approval)", { type: "object", properties: { command: { type: "string" } } },
    async (a) => runShell(workspace, arg<string>(a, "command")));
  registerTool("grep", "Search file contents in workspace", { type: "object", properties: { pattern: { type: "string" } } },
    async (a) => grepFiles(workspace, arg<string>(a, "pattern")).join("\n") || "(no matches)");
  registerTool("webfetch", "Fetch a URL as text", { type: "object", properties: { url: { type: "string" } } },
    async (a) => webfetch(arg<string>(a, "url")));
  registerTool("memory_save", "Save a fact to long-term memory", { type: "object", properties: { text: { type: "string" } } },
    async (a) => { saveMemory(arg<string>(a, "text")); return "saved"; });
  registerTool("memory_recall", "Recall facts from long-term memory", { type: "object", properties: { query: { type: "string" } } },
    async (a) => recallMemory(arg<string>(a, "query")) || "(nothing recalled)");
  registerTool("skill_save", "Save a reusable skill note", { type: "object", properties: { name: { type: "string" }, body: { type: "string" } } },
    async (a) => { saveSkill(arg<string>(a, "name"), arg<string>(a, "body")); return "skill saved"; });
  registerTool("ask_user", "Ask the user a question with options (use when requirements are ambiguous)", { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } } },
    async (a) => {
      const parsed = JSON.parse(a) as { question?: string; options?: string[] };
      return askUser(parsed.question ?? "?", Array.isArray(parsed.options) ? parsed.options.slice(0, 6) : []);
    });
}
