import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, splitMessage } from "./telegram.js";

describe("telegram helpers", () => {
  it("splits long messages under the limit", () => {
    const parts = splitMessage(`${"x".repeat(4000)}\n${"y".repeat(4000)}`);
    assert.ok(parts.length >= 2);
    assert.ok(parts.every((p) => p.length <= 4096));
  });

  it("keeps short messages whole", () => {
    assert.deepEqual(splitMessage("hi"), ["hi"]);
  });

  it("parses commands with bot mentions and args", () => {
    assert.deepEqual(parseCommand("/new"), { cmd: "new", arg: "" });
    assert.deepEqual(parseCommand("/model@mybot bar"), { cmd: "model", arg: "bar" });
    assert.equal(parseCommand("hello"), null);
  });
});
