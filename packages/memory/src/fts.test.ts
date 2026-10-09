import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { saveMemory } from "./db.js";
import { searchMemory } from "./fts.js";

describe("fts memory", () => {
  beforeEach(() => {
    process.env.HEXTRA_HOME = mkdtempSync(`${tmpdir()}/hextra-mem-`);
    (process.env as Record<string, string>).HOME = `${tmpdir()}/hextra-nohome`;
    saveMemory("wifi drops every night on termux");
    saveMemory("buy groceries tomorrow");
    saveMemory("termux wake lock prevents doze kills");
  });

  it("ranks multi-hit entries first", () => {
    const out = searchMemory("termux wake lock");
    const lines = out.split("\n");
    assert.ok(lines.length >= 2);
    assert.match(lines[0], /wake lock/);
  });

  it("returns empty when nothing matches", () => {
    assert.equal(searchMemory("qzzxpl orbital"), "");
  });
});
