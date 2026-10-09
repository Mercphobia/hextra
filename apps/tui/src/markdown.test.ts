import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tokenizeMarkdown } from "./markdown.js";

describe("markdown", () => {
  it("splits code blocks with language", () => {
    const t = tokenizeMarkdown("a\n```ts\nconst x = 1;\n```\nb");
    const cb = t.find((x) => x.kind === "codeblock");
    assert.equal(cb?.kind === "codeblock" && cb.lang, "ts");
    assert.match(cb?.kind === "codeblock" ? cb.text : "", /const x/);
  });

  it("finds bold, inline code, and lists", () => {
    const t = tokenizeMarkdown("**hi** and `x`\n- one\n- two");
    assert.ok(t.some((x) => x.kind === "bold" && x.text === "hi"));
    assert.ok(t.some((x) => x.kind === "code" && x.text === "x"));
    const l = t.find((x) => x.kind === "list");
    assert.deepEqual(l?.kind === "list" && l.items, ["one", "two"]);
  });
});
