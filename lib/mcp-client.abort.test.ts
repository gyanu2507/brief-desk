import assert from "node:assert/strict";
import { test } from "node:test";
import { callMcpTool } from "./mcp-client";

function hangUntilAbort(init?: { signal?: AbortSignal }): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      reject(new Error("expected AbortSignal on fetch"));
      return;
    }
    const fail = () => reject(new DOMException("The operation was aborted", "AbortError"));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

test("callMcpTool returns cancelled when signal aborts before fetch", async () => {
  const c = new AbortController();
  c.abort();
  const result = await callMcpTool(
    "brief_eval",
    { question: "x", draft: "y" },
    {
      mcpUrl: "http://127.0.0.1:9/mcp",
      signal: c.signal,
      timeoutMs: 5_000,
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
  assert.match(result.error || "", /cancel/i);
});

test(
  "callMcpTool marks timedOut when linked timeout aborts a hanging fetch",
  { timeout: 5_000 },
  async () => {
    const original = globalThis.fetch;
    globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
      hangUntilAbort(init)) as typeof fetch;

    try {
      const result = await callMcpTool(
        "brief_eval",
        { question: "x", draft: "y" },
        { mcpUrl: "http://example.test/mcp", timeoutMs: 80 },
      );
      assert.equal(result.ok, false);
      assert.equal(result.timedOut, true);
      assert.equal(result.cancelled, false);
      assert.match(result.error || "", /timed out/i);
    } finally {
      globalThis.fetch = original;
    }
  },
);

test(
  "callMcpTool marks cancelled when parent signal aborts mid-fetch",
  { timeout: 5_000 },
  async () => {
    const original = globalThis.fetch;
    const parent = new AbortController();
    globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
      hangUntilAbort(init)) as typeof fetch;

    try {
      const pending = callMcpTool(
        "brief_eval",
        { question: "x", draft: "y" },
        {
          mcpUrl: "http://example.test/mcp",
          signal: parent.signal,
          timeoutMs: 10_000,
        },
      );
      await new Promise((r) => setTimeout(r, 30));
      parent.abort();
      const result = await pending;
      assert.equal(result.ok, false);
      assert.equal(result.cancelled, true);
      assert.equal(result.timedOut, false);
    } finally {
      globalThis.fetch = original;
    }
  },
);
