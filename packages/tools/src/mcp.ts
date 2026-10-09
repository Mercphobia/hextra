import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { McpServerConfig } from "@hextra/core/config.js";
import type { ToolSchema } from "@hextra/core/llm/openai-client.js";

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 50) || "tool";
}

/** Allowlist filter. `allow` undefined = pass all (runtime approval still asks). */
export function filterMcpTools(server: McpServerConfig, tools: McpToolDef[]): McpToolDef[] {
  if (!server.allow) return tools;
  const allow = new Set(server.allow);
  return tools.filter((t) => allow.has(t.name));
}

export class McpClient {
  private proc: ChildProcess | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";

  constructor(private server: McpServerConfig) {}

  start(timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`mcp ${this.server.name}: start timeout`)), timeoutMs);
      try {
        this.proc = spawn(this.server.command, this.server.args ?? [], { stdio: ["pipe", "pipe", "inherit"] });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
        return;
      }
      this.proc.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`mcp ${this.server.name}: spawn failed: ${e.message}`));
      });
      const rl = createInterface({ input: this.proc.stdout! });
      rl.on("line", (line: string) => this.onLine(line));
      this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "hextra", version: "0.1.0" },
      }).then(() => {
        this.notify("notifications/initialized", {});
        clearTimeout(timer);
        resolve();
      }).catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  private onLine(line: string): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
    }
    if (msg.id === undefined) return;
    const cb = this.pending.get(msg.id);
    if (!cb) return;
    this.pending.delete(msg.id);
    if (msg.error) cb.reject(new Error(msg.error.message ?? "mcp error"));
    else cb.resolve(msg.result);
  }

  private send(obj: unknown): void {
    this.proc!.stdin!.write(`${JSON.stringify(obj)}\n`);
  }

  request(method: string, params: unknown, timeoutMs = 15_000): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp ${this.server.name}: ${method} timeout`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v: unknown) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async listTools(): Promise<McpToolDef[]> {
    const res = (await this.request("tools/list", {})) as { tools?: McpToolDef[] };
    return res.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = (await this.request("tools/call", { name, arguments: args })) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const texts = (res.content ?? []).map((c) => c.text ?? "").filter(Boolean);
    return texts.join("\n").slice(0, 8000) || "(empty mcp result)";
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }
}

export interface McpWiring {
  schemas: ToolSchema[];
  handlers: Record<string, (argsJson: string) => Promise<string>>;
  clients: McpClient[];
  warnings: string[];
}

/** Connect all configured servers, register filtered tools as mcp_<server>_<tool>. */
export async function connectMcpServers(servers: McpServerConfig[]): Promise<McpWiring> {
  const wiring: McpWiring = { schemas: [], handlers: {}, clients: [], warnings: [] };
  for (const srv of servers) {
    const client = new McpClient(srv);
    try {
      await client.start();
      const tools = filterMcpTools(srv, await client.listTools());
      for (const t of tools) {
        const name = `mcp_${sanitize(srv.name)}_${sanitize(t.name)}`;
        wiring.schemas.push({
          type: "function",
          function: {
            name,
            description: `[mcp:${srv.name}] ${t.description ?? t.name}`,
            parameters: t.inputSchema ?? { type: "object", properties: {} },
          },
        });
        wiring.handlers[name] = async (argsJson: string) => {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(argsJson) as Record<string, unknown>;
          } catch { /* pass empty */ }
          return client.callTool(t.name, args);
        };
      }
      wiring.clients.push(client);
    } catch (e) {
      wiring.warnings.push(`${srv.name}: ${e instanceof Error ? e.message : String(e)}`);
      client.stop();
    }
  }
  return wiring;
}
