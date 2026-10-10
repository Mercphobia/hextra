import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { deleteSession, listSessions, loadSession, newSession, saveSession } from "./sessions.js";

beforeEach(() => {
  process.env.HEXTRA_HOME = mkdtempSync(`${tmpdir()}/hextra-sess-`);
});

describe("sessions", () => {
  it("saves, lists, loads, and deletes", () => {
    const s = newSession("m1");
    s.history.push({ role: "user", content: "fix wifi please" });
    saveSession(s);
    const list = listSessions();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "fix wifi please");
    const loaded = loadSession(s.id);
    assert.equal(loaded?.model, "m1");
    assert.equal(loaded?.history.length, 1);
    assert.equal(deleteSession(s.id), true);
    assert.equal(listSessions().length, 0);
  });

  it("returns null for unknown ids", () => {
    assert.equal(loadSession("nope"), null);
    assert.equal(deleteSession("nope"), false);
  });
});
