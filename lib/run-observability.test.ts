import assert from "node:assert/strict";
import { test } from "node:test";
import { CANCELLED_MESSAGE, TIMEOUT_MESSAGE } from "./abort";
import {
  actionableErrorMessage,
  categorizeError,
  newRunId,
} from "./run-observability";

test("newRunId is stable-prefixed and unique", () => {
  const a = newRunId();
  const b = newRunId();
  assert.match(a, /^br_/);
  assert.notEqual(a, b);
});

test("categorizeError maps known failure classes", () => {
  assert.equal(categorizeError(CANCELLED_MESSAGE), "cancelled");
  assert.equal(categorizeError(TIMEOUT_MESSAGE), "timeout");
  assert.equal(categorizeError("Rate limit reached"), "rate_limit");
  assert.equal(categorizeError("MCP orchestrate failed"), "mcp");
  assert.equal(categorizeError("draft model returned empty content"), "model");
});

test("actionableErrorMessage includes run id", () => {
  const msg = actionableErrorMessage("timeout", TIMEOUT_MESSAGE, "br_test");
  assert.match(msg, /timed out/i);
  assert.match(msg, /br_test/);
});
