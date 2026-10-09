import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { addBot, getBot, loadBots, removeBot } from "./bots.js";

beforeEach(() => {
  process.env.HEXTRA_HOME = mkdtempSync(`${tmpdir()}/hextra-bots-`);
});

describe("bots", () => {
  it("adds, gets, and removes bots", () => {
    addBot("coder", { model: "m1", system: "you write code" });
    assert.equal(loadBots().length, 1);
    assert.equal(getBot("coder")?.model, "m1");
    assert.equal(removeBot("coder"), true);
    assert.equal(loadBots().length, 0);
  });

  it("rejects duplicate and malformed names", () => {
    addBot("r1", {});
    assert.throws(() => addBot("r1", {}), /exists/);
    assert.throws(() => addBot("bad name!", {}), /bad bot name/);
  });
});
