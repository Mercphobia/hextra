export interface PromptParts {
  identity?: string;
  skills?: string;
  contextFiles?: string;
  memory?: string;
  profile?: string;
}

/** Hermes-style tiers: stable -> context -> volatile. Never mutate stable mid-turn. */
export function buildSystemPrompt(p: PromptParts): string {
  const stable = [
    "You are Hextra, a Termux-first coding assistant. Be concise and factual.",
    p.identity ?? "",
    p.skills ? `## Skills\n${p.skills}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const context = [p.contextFiles ? `## Project context\n${p.contextFiles}` : ""].filter(Boolean).join("\n\n");
  const volatile = [
    p.memory ? `## Memory\n${p.memory}` : "",
    p.profile ? `## User\n${p.profile}` : "",
    `## Time\n${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [stable, context, volatile].filter(Boolean).join("\n\n---\n\n");
}
