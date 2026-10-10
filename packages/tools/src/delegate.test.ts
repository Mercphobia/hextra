import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { clearTools, handlers, listSchemas } from "./registry.js";
import { wireTools } from "./wiring.js";

function sseData(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}`;
}

describe("delegate", () => {
  it("runs an isolated read-only subagent and returns its summary", async () => {
    const workspace = mkdtempSync(`${tmpdir()}/hextra-delegate-`);
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: unknown) => {
      calls.push("chat");
      const body = new Response(
        `${sseData({ choices: [{ delta: { content: "subagent summary here" } }] })}\n${sseData("[DONE]")}\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
      void init;
      return body;
    }) as typeof fetch;
    try {
      clearTools();
      wireTools(workspace, {
        baseUrl: "https://x.test/v1", apiKey: "k", model: "m",
        workspace, theme: "dark", autoSkill: false,
      });
      const names = listSchemas().map((s) => s.function.name);
      assert.ok(names.includes("delegate"));
      const out = await handlers()["delegate"](JSON.stringify({ task: "summarize://" }));
      assert.match(out, /subagent summary/);
      assert.ok(calls.length >= 1);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
