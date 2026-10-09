import type { ToolSchema } from "@hextra/core/llm/openai-client.js";

export interface RegisteredTool extends ToolSchema {
  run: (argsJson: string) => Promise<string>;
}

const tools = new Map<string, RegisteredTool>();

export function registerTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  run: (argsJson: string) => Promise<string>,
): void {
  const tool: RegisteredTool = { type: "function", function: { name, description, parameters }, run };
  tools.set(name, tool);
}

export function listSchemas(): ToolSchema[] {
  return [...tools.values()].map(({ run: _r, ...schema }) => schema);
}

export function handlers(): Record<string, (a: string) => Promise<string>> {
  return Object.fromEntries([...tools.entries()].map(([k, v]) => [k, v.run]));
}

export function clearTools(): void {
  tools.clear();
}
