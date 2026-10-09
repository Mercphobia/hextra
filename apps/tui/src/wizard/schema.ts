export const WIZARD_STEPS = [
  "welcome",
  "auth",
  "provider-openai",
  "model-fallback",
  "memory",
  "connect",
  "skills-mcp",
  "schedule",
  "verify",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export const STEP_HELP: Record<WizardStep, string> = {
  welcome: "Environment check: node, storage, workspace",
  auth: "Choose cloud API key or local endpoint",
  "provider-openai": "OpenAI-compatible baseURL + key + model, live tested",
  "model-fallback": "Optional local fallback (Ollama/LM Studio)",
  memory: "Init file memory + skills directory",
  connect: "CLI on by default; store platform tokens for later",
  "skills-mcp": "Auto-skill toggle + MCP allowlist",
  schedule: "Cron toggle + wake-lock reminder",
  verify: "Save config 0600 + end-to-end chat test",
};
