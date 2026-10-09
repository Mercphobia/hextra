const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9-_]{10,}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/=]{8,}/gi,
  /(api[_-]?key|token|secret)["'\s:=]+[A-Za-z0-9\-._~+/=]{8,}/gi,
];

/** Scrub probable credentials from anything written to logs, memory, or disk. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, "[redacted]");
  }
  return out;
}

/** Hard cap for a single user turn. Truncation is announced, never silent. */
export const MAX_INPUT_CHARS = 20_000;

export function clampInput(input: string): { text: string; truncated: boolean } {
  if (input.length <= MAX_INPUT_CHARS) return { text: input, truncated: false };
  return { text: input.slice(0, MAX_INPUT_CHARS), truncated: true };
}
