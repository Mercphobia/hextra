import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { askUser, setAskHandler } from "./ask.js";

describe("ask_user", () => {
  it("falls back gracefully without a UI handler, then uses it", async () => {
    assert.match(await askUser("continue?", ["yes", "no"]), /best judgment/);
    setAskHandler(async (_q, opts) => opts[0] ?? "?");
    assert.equal(await askUser("pick?", ["a", "b"]), "a");
  });
});
