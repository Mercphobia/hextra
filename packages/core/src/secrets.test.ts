import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampInput, redactSecrets, MAX_INPUT_CHARS } from "./secrets.js";

describe("hardening", () => {
  it("redacts api keys, bearer tokens, and sk- secrets", () => {
    const out = redactSecrets("key sk-abc123xyz890 and Bearer tok12345678 api_key=supersecret99");
    assert.ok(!out.includes("sk-abc123xyz890"));
    assert.ok(!out.includes("tok12345678"));
    assert.ok(!out.includes("supersecret99"));
    assert.match(out, /\[redacted\]/);
  });

  it("leaves normal text untouched", () => {
    assert.equal(redactSecrets("read the readme file"), "read the readme file");
  });

  it("clamps oversized input with a flag", () => {
    const big = "x".repeat(MAX_INPUT_CHARS + 1);
    const r = clampInput(big);
    assert.equal(r.truncated, true);
    assert.equal(r.text.length, MAX_INPUT_CHARS);
  });
});
