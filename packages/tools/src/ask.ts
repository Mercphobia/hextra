/** UI-injected handler for the ask_user tool (each TUI sets its own). */
let handler: ((question: string, options: string[]) => Promise<string>) | null = null;

export function setAskHandler(fn: (question: string, options: string[]) => Promise<string>): void {
  handler = fn;
}

export function askUser(question: string, options: string[]): Promise<string> {
  if (!handler) return Promise.resolve("no ask UI available; proceeding with best judgment");
  return handler(question, options);
}
