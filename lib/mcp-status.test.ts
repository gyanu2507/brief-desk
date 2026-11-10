import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpStatusMessage } from "./mcp-status";

test("mcpStatusMessage stays quiet during a fast first check and when ready", () => {
  assert.equal(mcpStatusMessage(null, false, false), null);
  assert.equal(mcpStatusMessage(true, true, false), null);
});

test("mcpStatusMessage explains a slow first check as a wake-up", () => {
  assert.match(mcpStatusMessage(null, false, true) ?? "", /^Waking the backend/);
});

test("mcpStatusMessage does not tell visitors to redeploy when the backend is down", () => {
  const msg = mcpStatusMessage(false, false, true) ?? "";
  assert.match(msg, /checks again every 5 seconds/);
  assert.doesNotMatch(msg, /redeploy/i);
});

test("mcpStatusMessage flags a backend missing brief_orchestrate", () => {
  assert.match(mcpStatusMessage(true, false, false) ?? "", /missing brief_orchestrate/);
});
