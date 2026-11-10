import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpHealthUrl, waitForMcp } from "./mcp-client";

const REMOTE = "https://mcp.example.test/mcp";

function fakeFetch(responses: Array<"ok" | "fail" | "hang">) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    const next = responses.shift() ?? "ok";
    if (next === "ok") return new Response("{}", { status: 200 });
    if (next === "fail") return new Response("", { status: 502 });
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  }) as typeof fetch;
  return { impl, calls };
}

test("mcpHealthUrl swaps the /mcp path for /health", () => {
  assert.equal(mcpHealthUrl(REMOTE), "https://mcp.example.test/health");
  assert.equal(mcpHealthUrl("http://127.0.0.1:3108/mcp/"), "http://127.0.0.1:3108/health");
});

test("waitForMcp skips the check for a local backend", async () => {
  const { impl, calls } = fakeFetch(["fail"]);
  const r = await waitForMcp({ mcpUrl: "http://127.0.0.1:3108/mcp", fetchImpl: impl });
  assert.deepEqual(r, { waited: false, ok: true, ms: 0 });
  assert.equal(calls.length, 0);
});

test("waitForMcp returns at once when the backend is awake", async () => {
  const { impl } = fakeFetch(["ok"]);
  let waking = 0;
  const r = await waitForMcp({ mcpUrl: REMOTE, fetchImpl: impl, onWaking: () => waking++ });
  assert.equal(r.ok, true);
  assert.equal(r.waited, false);
  assert.equal(waking, 0);
});

test("waitForMcp reports waking once, then succeeds when health comes up", async () => {
  const { impl, calls } = fakeFetch(["hang", "fail", "ok"]);
  let waking = 0;
  const r = await waitForMcp({
    mcpUrl: REMOTE,
    fetchImpl: impl,
    quickMs: 20,
    pollMs: 5,
    budgetMs: 2_000,
    onWaking: () => waking++,
  });
  assert.equal(r.ok, true);
  assert.equal(r.waited, true);
  assert.equal(waking, 1);
  assert.equal(calls.length, 3);
});

test("waitForMcp gives up after its budget with the last error", async () => {
  const { impl } = fakeFetch(Array(1000).fill("fail"));
  const r = await waitForMcp({
    mcpUrl: REMOTE,
    fetchImpl: impl,
    quickMs: 10,
    pollMs: 5,
    budgetMs: 60,
  });
  assert.equal(r.ok, false);
  assert.equal(r.waited, true);
  assert.equal(r.error, "health returned HTTP 502");
});

test("waitForMcp stops when the run is cancelled", async () => {
  const { impl } = fakeFetch(Array(1000).fill("hang"));
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  await assert.rejects(
    waitForMcp({ mcpUrl: REMOTE, fetchImpl: impl, signal: ac.signal, quickMs: 10, budgetMs: 5_000 }),
    (e: unknown) => e instanceof Error && e.name === "AbortError",
  );
});
