import { existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * The ANDROIDTUI loader resolves the Bionic .so in this order:
 *   1. <pkg>/../../prebuilt/aarch64-android/libopentui.so  (existsSync check)
 *   2. import("@opentui/core-android-arm64")  <- broken on Node: its index.js
 *      uses `with { type: "file" }`, a Bun-only module feature, so Node throws
 *      and the loader reports the library as missing.
 * This postinstall symlinks the installed Bionic .so into the prebuilt path
 * so step 1 wins and Node --experimental-ffi loads it via FFI.
 * Safe no-op anywhere the native package is absent (desktop, CI).
 */
function findSo(dir) {
  let hits = [];
  try {
    hits = readdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  const so = hits.find((f) => f.endsWith("libopentui.so"));
  return so ? join(dir, so) : null;
}

const root = new URL("..", import.meta.url).pathname;
const src = findSo(join(root, "node_modules", "@opentui", "core-android-arm64"));
if (!src || !existsSync(src)) {
  console.log("[hextra] android native lib absent, skipping alias (desktop/CI)");
  process.exit(0);
}
const destDir = join(root, "node_modules", "prebuilt", "aarch64-android");
const dest = join(destDir, "libopentui.so");
mkdirSync(destDir, { recursive: true });
try {
  unlinkSync(dest);
} catch { /* fresh link */ }
symlinkSync(src, dest);
console.log(`[hextra] linked native lib -> ${dest}`);
