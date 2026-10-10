/** @jsxImportSource @androidtui/solid */
import { createCliRenderer } from "@opentui/core";
import { render, useKeyboard } from "@androidtui/solid";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG = join(homedir(), "kb.log");
try {
  fs.unlinkSync(LOG);
} catch {}
const log = (o: unknown) => fs.appendFileSync(LOG, `${JSON.stringify(o)}\n`);

function Probe() {
  const [n, setN] = createSignal(0);
  log({ boot: true, hasBun: !!(process.versions as Record<string, string>).bun });
  onMount(() => log({ mounted: true }));
  onCleanup(() => log({ cleaned: true }));
  createEffect(() => {
    n();
    log({ effectRan: true });
  });
  try {
    const stdin = process.stdin as unknown as {
      isTTY?: boolean;
      isRaw?: boolean;
      on: (ev: string, fn: (d: unknown) => void) => void;
      resume?: () => void;
      setRawMode?: (v: boolean) => void;
    };
    log({ stdinTTY: !!stdin.isTTY, stdinRaw: !!(stdin as { isRaw?: boolean }).isRaw });
    stdin.on("data", (d) => log({ rawData: String(d).slice(0, 40) }));
    try {
      stdin.resume?.();
      log({ resumed: true });
    } catch (e) {
      log({ resumeFail: e instanceof Error ? e.message : String(e) });
    }
  } catch (e) {
    log({ stdinFail: e instanceof Error ? e.message : String(e) });
  }
  useKeyboard((k) => {
    log({ name: (k as { name?: unknown }).name, seq: (k as { sequence?: unknown }).sequence, ctrl: (k as { ctrl?: unknown }).ctrl, type: (k as { eventType?: unknown }).eventType });
    setN((x) => x + 1);
  });
  return (
    <box flexDirection="column" padding={1}>
      <text>probe: press a b c, Esc exits (count: {n()})</text>
    </box>
  );
}

const renderer = await createCliRenderer();
let done = false;
process.on("SIGINT", () => {
  if (!done) {
    done = true;
    try {
      renderer.destroy();
    } catch {}
    process.exit(0);
  }
});
// Auto-exit after 30s so a hung run always restores the terminal.
setTimeout(() => {
  if (!done) {
    done = true;
    try {
      renderer.destroy();
    } catch {}
    process.exit(0);
  }
}, 30000);
await render(() => <Probe />, renderer);
