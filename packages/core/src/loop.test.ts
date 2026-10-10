import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "./agent-loop.js";

function sseData(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}`;
}

function toolCallLoop(): Response {
  return new Response(
    `${sseData({ choices: [{ delta: { tool_calls: [{ id: "1", type: "function", function: { name: "ping", arguments: "{}" } }] } }] })}\n${sseData("[DONE]")}\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

const cfg = {
  baseUrl: "https://x.test/v1", apiKey: "k", model: "m",
  workspace: "/tmp", theme: "dark" as const, autoSkill: false,
};

describe("iteration cap", () => {
  it("stops after maxIterations with a continue hint", async () => {
    let calls = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return toolCallLoop();
    }) as typeof fetch;
    try {
      const out = await runAgentLoop({
        cfg: { ...cfg, maxIterations: 3 },
        system: "s",
        input: "go",
        tools: [{ type: "function", function: { name: "ping", description: "p", parameters: {} } }],
        handlers: { ping: async () => "pong" },
      });
      assert.match(out, /stopped after 3 tool iterations/);
      assert.match(out, /lanjutkan/);
      assert.equal(calls, 3);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
