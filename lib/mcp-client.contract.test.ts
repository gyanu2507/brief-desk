import assert from "node:assert/strict";
import { test } from "node:test";
import { callMcpTool } from "./mcp-client";

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

test("callMcpTool parses successful tools/call SSE contract", async () => {
  const original = globalThis.fetch;
  let step = 0;
  globalThis.fetch = (async () => {
    step += 1;
    if (step === 1) {
      return new Response("{}", {
        status: 200,
        headers: { "mcp-session-id": "sess-1" },
      });
    }
    if (step === 2) {
      return new Response("", { status: 202 });
    }
    return new Response(
      sse({
        jsonrpc: "2.0",
        id: 2,
        result: {
          content: [{ type: "text", text: '{"ok":true,"repos":[]}' }],
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const result = await callMcpTool(
      "brief_corpus",
      { question: "x" },
      { mcpUrl: "http://example.test/mcp", timeoutMs: 2_000 },
    );
    assert.equal(result.ok, true);
    assert.match(result.text, /"ok":true/);
    assert.equal(result.cancelled, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("callMcpTool surfaces MCP isError failure path", async () => {
  const original = globalThis.fetch;
  let step = 0;
  globalThis.fetch = (async () => {
    step += 1;
    if (step === 1) {
      return new Response("{}", {
        status: 200,
        headers: { "mcp-session-id": "sess-2" },
      });
    }
    if (step === 2) return new Response("", { status: 202 });
    return new Response(
      sse({
        jsonrpc: "2.0",
        id: 2,
        result: {
          isError: true,
          content: [{ type: "text", text: "tool exploded" }],
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const result = await callMcpTool(
      "brief_eval",
      { question: "q", draft: "d" },
      { mcpUrl: "http://example.test/mcp", timeoutMs: 2_000 },
    );
    assert.equal(result.ok, false);
    assert.match(result.error || "", /exploded/);
  } finally {
    globalThis.fetch = original;
  }
});

test("callMcpTool surfaces JSON-RPC error contract", async () => {
  const original = globalThis.fetch;
  let step = 0;
  globalThis.fetch = (async () => {
    step += 1;
    if (step === 1) {
      return new Response("{}", {
        status: 200,
        headers: { "mcp-session-id": "sess-3" },
      });
    }
    if (step === 2) return new Response("", { status: 202 });
    return new Response(
      sse({
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32602, message: "Unknown tool: brief_missing" },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const result = await callMcpTool(
      "brief_missing",
      {},
      { mcpUrl: "http://example.test/mcp", timeoutMs: 2_000 },
    );
    assert.equal(result.ok, false);
    assert.match(result.error || "", /Unknown tool/);
  } finally {
    globalThis.fetch = original;
  }
});
