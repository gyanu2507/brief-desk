import assert from "node:assert/strict";
import { test } from "node:test";
import { isMcpToolMissing } from "./github-trending";

test("isMcpToolMissing detects -32602 tool not found", () => {
  assert.equal(
    isMcpToolMissing("MCP error -32602: Tool brief_github_trending not found"),
    true,
  );
  assert.equal(isMcpToolMissing("timeout"), false);
  assert.equal(isMcpToolMissing(undefined), false);
});
