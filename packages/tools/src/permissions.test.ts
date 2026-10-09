import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, type Policy } from "./permissions.js";
import { assertInside } from "./fs.js";
import { editFile } from "./patch.js";

describe("permissions", () => {
  const base: Policy = { allow: ["read_file"], deny: ["shell"] };
  it("deny wins over everything", () => {
    assert.equal(decide(base, new Set(["shell"]), "shell"), "deny");
  });
  it("asks for risky tools by default", () => {
    assert.equal(decide(base, new Set(), "write_file"), "ask");
  });
  it("allows safe tools without prompting", () => {
    assert.equal(decide(base, new Set(), "grep"), "allow");
  });
  it("session grant allows risky tool once", () => {
    assert.equal(decide(base, new Set(["edit_file"]), "edit_file"), "allow");
  });
});

describe("sandbox", () => {
  it("rejects path escape", () => {
    assert.throws(() => assertInside("/tmp/ws", "../../etc/passwd"), /path escape/);
  });
});

describe("editFile", () => {
  it("replaces exactly one block", () => {
    const dir = mkdtempSync(join(tmpdir(), "hextra-"));
    writeFileSync(join(dir, "a.txt"), "hello world");
    const out = editFile(dir, "a.txt", "world", "termux");
    assert.match(out, /1 block replaced/);
  });
  it("refuses ambiguous matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "hextra-"));
    writeFileSync(join(dir, "a.txt"), "x x x");
    assert.match(editFile(dir, "a.txt", "x", "y"), /be more specific/);
  });
});
