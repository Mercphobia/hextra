/** @jsxImportSource @androidtui/solid */
import { createSignal } from "solid-js";
import { render, useKeyboard } from "@androidtui/solid";
import { createCliRenderer } from "@opentui/core";

function HelloApp(props: { onExit: () => void }) {
  const [typed, setTyped] = createSignal("");
  useKeyboard((k) => {
    if (k.name === "c" && k.ctrl) {
      props.onExit();
      return;
    }
    if (k.name === "escape") {
      props.onExit();
      return;
    }
    if (k.name === "backspace") {
      setTyped((t) => t.slice(0, -1));
      return;
    }
    if (k.name === "return" || k.name === "kpenter") {
      setTyped((t) => t + "\n");
      return;
    }
    if (k.sequence && k.sequence.length === 1 && !k.ctrl && !k.meta && k.eventType !== "release") {
      if (k.sequence >= " " || k.sequence === "\t") setTyped((t) => t + k.sequence);
    }
  });
  return (
    <box flexDirection="column" padding={1}>
      <text>hextra solid hello — type text, Enter newline, Esc/Ctrl+C exits</text>
      <text>you typed:</text>
      <text>{typed()}</text>
    </box>
  );
}

export async function runNativeTui(): Promise<void> {
  // NOTE: the renderer MUST come from "@opentui/core" (the exact copy that
  // @androidtui/solid uses). A renderer from "@androidtui/core" fails the
  // instanceof check inside solid's render(), which then spawns a second
  // CliRenderer and dies with "stdin is already used by another CliRenderer".
  let create: typeof import("@opentui/core").createCliRenderer;
  try {
    ({ createCliRenderer: create } = await import("@opentui/core"));
  } catch (e) {
    console.log(`native TUI unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const renderer = await create();
  await new Promise<void>((resolve) => {
    const exit = () => {
      try {
        renderer.destroy();
      } catch {
        /* already gone */
      }
      resolve();
    };
    process.on("SIGINT", exit);
    void render(() => <HelloApp onExit={exit} />, renderer);
  });
}
