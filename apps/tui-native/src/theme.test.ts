import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadThemeTokens } from "./theme.js";

beforeEach(() => {
  process.env.HEXTRA_HOME = mkdtempSync(`${tmpdir()}/hextra-uitheme-`);
});

describe("ui theme", () => {
  it("falls back to opencode dark defaults", () => {
    const t = loadThemeTokens();
    assert.equal(t.text, "#f8fafc");
    assert.equal(t.error, "#ef4444");
  });

  it("honors legacy and opencode token names", () => {
    writeFileSync(join(process.env.HEXTRA_HOME!, "theme.json"), JSON.stringify({
      user: "magenta",
      textMuted: "#111111",
      panelBg: "#222222",
    }));
    const t = loadThemeTokens();
    assert.equal(t.user, "magenta");
    assert.equal(t.textMuted, "#111111");
    assert.equal(t.backgroundPanel, "#222222");
  });
});
