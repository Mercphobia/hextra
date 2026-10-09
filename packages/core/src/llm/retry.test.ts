import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chatCompletions } from "./openai-client.js";

describe("rate-limit retry", () => {
  it("retries 429s then throws a rate-limit error", async () => {
    let calls = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("slow down", { status: 429 });
    }) as typeof fetch;
    try {
      await assert.rejects(() => chatCompletions(
        { baseUrl: "https://x.test/v1", apiKey: "k", model: "m" },
        [{ role: "user", content: "hi" }],
      ), /rate limited after retries/);
      assert.equal(calls, 4);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("does not retry other errors", async () => {
    let calls = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("bad key", { status: 401 });
    }) as typeof fetch;
    try {
      await assert.rejects(() => chatCompletions(
        { baseUrl: "https://x.test/v1", apiKey: "k", model: "m" },
        [{ role: "user", content: "hi" }],
      ), /provider 401/);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
