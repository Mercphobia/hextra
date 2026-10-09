import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fallbackProfile, primaryProfile } from "./llm/router.js";
import { buildSystemPrompt } from "./prompt-builder.js";

describe("router", () => {
  it("builds primary and fallback profiles", () => {
    const cfg = {
      baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m",
      fallbackBaseUrl: "http://127.0.0.1:11434/v1", fallbackModel: "qwen3:4b",
      workspace: "/tmp", theme: "dark" as const, autoSkill: true,
    };
    assert.equal(primaryProfile(cfg).model, "m");
    assert.equal(fallbackProfile(cfg)?.model, "qwen3:4b");
  });
});

describe("prompt-builder", () => {
  it("keeps tier order stable->context->volatile", () => {
    const s = buildSystemPrompt({ identity: "I", contextFiles: "C", memory: "M" });
    assert.ok(s.indexOf("I") < s.indexOf("C") && s.indexOf("C") < s.indexOf("M"));
  });
});
