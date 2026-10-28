import assert from "node:assert/strict";
import { test } from "node:test";
import { CANCELLED_MESSAGE } from "./abort";
import { runBriefPipeline } from "./brief-run";

test("runBriefPipeline returns CANCELLED_MESSAGE when signal is pre-aborted", async () => {
  const c = new AbortController();
  c.abort();
  const result = await runBriefPipeline(
    { source: "corpus", question: "What is brief-desk?" },
    { signal: c.signal },
  );
  assert.equal(result.ok, false);
  assert.ok(result.error?.startsWith(CANCELLED_MESSAGE));
  assert.ok(result.runId);
  assert.equal(result.errorCategory, "cancelled");
});

test("runBriefPipeline rejects empty question without calling MCP", async () => {
  const result = await runBriefPipeline({ source: "auto", question: "hi" });
  assert.equal(result.ok, false);
  assert.match(result.error || "", /required/i);
});
