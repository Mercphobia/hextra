import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTheme } from "./config.js";

beforeEach(() => {
  process.env.HEXTRA_HOME = mkdtempSync(`${tmpdir()}/hextra-theme-`);
});

describe("theme", () => {
  it("returns empty defaults when absent", () => {
    assert.deepEqual(loadTheme(), {});
  });

  it("loads overrides and ignores corrupt files", () => {
    mkdirSync(join(process.env.HEXTRA_HOME!, ".config", "hextra"), { recursive: true });
    const p = join(process.env.HEXTRA_HOME!, ".config", "hextra", "theme.json");
    writeFileSync(p, JSON.stringify({ user: "magenta", panelBg: "#111111" }));
    assert.deepEqual(loadTheme(), { user: "magenta", panelBg: "#111111" });
    writeFileSync(p, "{oops");
    assert.deepEqual(loadTheme(), {});
  });
});
