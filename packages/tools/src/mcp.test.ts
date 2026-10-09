import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterMcpTools, McpClient, sanitize } from "./mcp.js";

describe("mcp filter", () => {
  const tools = [
    { name: "read", description: "r" },
    { name: "exec", description: "x" },
  ];
  it("passes all when allow is undefined", () => {
    assert.equal(filterMcpTools({ name: "s", command: "x" }, tools).length, 2);
  });
  it("restricts to the allowlist", () => {
    const out = filterMcpTools({ name: "s", command: "x", allow: ["read"] }, tools);
    assert.deepEqual(out.map((t) => t.name), ["read"]);
  });
  it("sanitizes tool names for the OpenAI API", () => {
    assert.equal(sanitize("My Server!"), "my_server_");
  });
});

describe("mcp client", () => {
  it("fails fast on a missing binary", async () => {
    const c = new McpClient({ name: "bad", command: "hextra-no-such-bin-xyz" });
    await assert.rejects(() => c.start(3000), /spawn failed|ENOENT/);
  });

  it("completes a handshake with a mock server", async () => {
    const script = [
      "const rl=require('readline').createInterface({input:process.stdin});",
      "rl.on('line',(l)=>{",
      "  let m; try{m=JSON.parse(l);}catch{return;}",
      "  if(m.id===undefined)return;",
      "  let r={};",
      "  if(m.method==='initialize')r={protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'mock',version:'1'}};",
      "  if(m.method==='tools/list')r={tools:[{name:'echo',description:'echo',inputSchema:{type:'object',properties:{}}}]};",
      "  if(m.method==='tools/call')r={content:[{type:'text',text:'mock:'+JSON.stringify(m.params.arguments)}]};",
      "  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:r})+'\\n');",
      "});",
    ].join("\n");
    const c = new McpClient({ name: "mock", command: "node", args: ["-e", script] });
    try {
      await c.start(8000);
      const tools = await c.listTools();
      assert.deepEqual(tools.map((t) => t.name), ["echo"]);
      const out = await c.callTool("echo", { a: 1 });
      assert.match(out, /mock:/);
    } finally {
      c.stop();
    }
  });
});
