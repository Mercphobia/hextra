import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLeader, matchBind, matchCombo } from "./keybinds.js";

describe("keybinds", () => {
  it("matches plain, ctrl, and shift combos", () => {
    assert.equal(matchCombo({ name: "escape" }, "escape"), true);
    assert.equal(matchCombo({ name: "x", ctrl: true }, "ctrl+x"), true);
    assert.equal(matchCombo({ name: "x" }, "ctrl+x"), false);
    assert.equal(matchCombo({ name: "tab", shift: true }, "shift+tab"), true);
    assert.equal(matchCombo({ name: "return" }, "return"), true);
    assert.equal(matchCombo({ name: "kpenter" }, "return"), true);
  });

  it("requires an armed leader for leader combos", () => {
    assert.equal(matchCombo({ name: "m" }, "<leader>m", false), false);
    assert.equal(matchCombo({ name: "m" }, "<leader>m", true), true);
    assert.equal(matchBind({ name: "c", ctrl: true }, "ctrl+c,ctrl+d"), true);
  });

  it("tracks leader arming with timeout", () => {
    const l = createLeader(50);
    assert.equal(l.feed({ name: "x", ctrl: true }), "leader");
    assert.equal(l.consume(), true);
    assert.equal(l.consume(), false);
  });
});
