import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, effectiveApproval, type Policy } from "./permissions.js";
import { assertInside } from "./fs.js";
import { editFile } from "./patch.js";

describe("permissions", () => {
  const base: Policy = { allow: ["read_file"], deny: ["shell"] };
  it("resolves approval mode: flag wins, then config, default auto", () => {
    assert.equal(effectiveApproval({}, false), "auto");
    assert.equal(effectiveApproval({ approval: "auto" }, false), "auto");
    assert.equal(effectiveApproval({ approval: "strict" }, true), "auto");
    assert.equal(effectiveApproval({ approval: "strict" }, false), "strict");
  });
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

  it("parses natural approval answers", async () => {    const { parseApprovalAnswer } = await import("./permissions.js");
    assert.equal(parseApprovalAnswer("al"), "once");
    assert.equal(parseApprovalAnswer("YA"), "once");
    assert.equal(parseApprovalAnswer(""), "once");
    assert.equal(parseApprovalAnswer("ok"), "once");
    assert.equal(parseApprovalAnswer("boleh"), "once");
    assert.equal(parseApprovalAnswer("gas"), "once");
    assert.equal(parseApprovalAnswer("w"), "always");
    assert.equal(parseApprovalAnswer("selalu"), "always");
    assert.equal(parseApprovalAnswer("d"), "deny");
    assert.equal(parseApprovalAnswer("no"), "deny");
    assert.equal(parseApprovalAnswer("jangan"), "deny");
  });
});

describe("sandbox", () => {
  it("rejects path escape", () => {
    assert.throws(() => assertInside("/tmp/ws", "../../etc/passwd"), /path escape/);
  });

  it("allows configured extra roots", async () => {
    const { setExtraRoots } = await import("./fs.js");
    setExtraRoots(["/tmp/extra-root"]);
    assert.equal(assertInside("/tmp/ws", "/tmp/extra-root/f.txt"), "/tmp/extra-root/f.txt");
    assert.throws(() => assertInside("/tmp/ws", "/etc/passwd"), /path escape/);
    setExtraRoots([]);
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
