import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chatCompletions } from "./openai-client.js";

function sseResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l + "\n"));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("sse parser", () => {
  it("collects reasoning, content, and tool calls", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => sseResponse([
      `data: {"choices":[{"delta":{"reasoning_content":"let me think"}}]}`,
      `data: {"choices":[{"delta":{"content":"hi"}}]}`,
      `data: {"choices":[{"delta":{"tool_calls":[{"id":"1","type":"function","function":{"name":"grep","arguments":"{}"}}]}}]}`,
      `data: [DONE]`,
    ])) as typeof fetch;
    try {
      const tokens: string[] = [];
      const reasoning: string[] = [];
      const res = await chatCompletions(
        { baseUrl: "https://x.test/v1", apiKey: "k", model: "m" },
        [{ role: "user", content: "hi" }],
        [],
        { onToken: (t) => tokens.push(t), onReasoning: (t) => reasoning.push(t) },
      );
      assert.equal(res.content, "hi");
      assert.equal(res.reasoning, "let me think");
      assert.equal(res.toolCalls[0]?.function.name, "grep");
      assert.deepEqual(tokens, ["hi"]);
      assert.deepEqual(reasoning, ["let me think"]);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
