import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderDiff } from "./diff.js";

describe("renderDiff", () => {
  it("prefixes removed and added lines", () => {
    const out = renderDiff("hello\nworld", "hello\ntermux");
    assert.deepEqual(out, ["- hello", "- world", "+ hello", "+ termux"]);
  });

  it("truncates long blocks", () => {
    const big = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
    const out = renderDiff(big, big);
    assert.ok(out.length < 30);
    assert.match(out[out.length - 1], /truncated/);
  });
});
