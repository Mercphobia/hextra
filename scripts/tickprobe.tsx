/** @jsxImportSource @androidtui/solid */
import { createCliRenderer } from "@opentui/core";
import { render } from "@androidtui/solid";
import { createSignal } from "solid-js";

function Probe() {
  const [n, setN] = createSignal(0);
  setInterval(() => {
    setN((x) => x + 1);
  }, 1000);
  return (
    <box flexDirection="column" padding={1}>
      <text>tick test — number below must increase every second:</text>
      <text>n = {n()}</text>
    </box>
  );
}

const renderer = await createCliRenderer();
setTimeout(() => {
  try {
    renderer.destroy();
  } catch {}
  process.exit(0);
}, 8000);
await render(() => <Probe />, renderer);
