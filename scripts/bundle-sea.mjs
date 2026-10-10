import { build } from "esbuild";
import { mkdirSync } from "node:fs";

// Bundle the built CLI (ESM dist + deps) into one ESM file for Node SEA
// (mainFormat: module). react-devtools-core is only lazily imported by
// Ink's devtools path and never executes in production.
await build({
  entryPoints: ["apps/tui/dist/app.js"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "scripts/sea/bundle.mjs",
  alias: { "react-devtools-core": "./scripts/sea/devtools-stub.js" },
  // Native OpenTUI bindings must never bundle into SEA (Bionic .so ships
  // next to the binary on Termux instead). tui-native stays npm/Bun-only.
  // solid-js rides along as external for the same reason.
  external: ["@androidtui/*", "solid-js"],
  logLevel: "info",
});
mkdirSync("dist-sea", { recursive: true });
