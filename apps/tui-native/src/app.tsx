import { createSignal } from "solid-js";
import { render, useKeyboard } from "@androidtui/solid";
import { createCliRenderer } from "@androidtui/core";

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
  let core: typeof import("@androidtui/core");
  try {
    core = await import("@androidtui/core");
  } catch (e) {
    console.log(`native TUI unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const renderer = await core.createCliRenderer();
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
