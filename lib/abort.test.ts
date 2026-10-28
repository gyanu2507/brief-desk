import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANCELLED_MESSAGE,
  isAbortError,
  linkAbortSignals,
  throwIfAborted,
  timeoutSignal,
  withTimeout,
} from "./abort";

test("isAbortError detects AbortError and TimeoutError", () => {
  assert.equal(isAbortError(new DOMException("x", "AbortError")), true);
  assert.equal(isAbortError(new DOMException("x", "TimeoutError")), true);
  assert.equal(isAbortError(new Error("The operation was aborted")), true);
  assert.equal(isAbortError(new Error("plain failure")), false);
});

test("throwIfAborted throws when signal already aborted", () => {
  const c = new AbortController();
  c.abort();
  assert.throws(() => throwIfAborted(c.signal), (e: unknown) => isAbortError(e));
});

test("linkAbortSignals aborts when either input aborts", async () => {
  const a = new AbortController();
  const b = new AbortController();
  const linked = linkAbortSignals(a.signal, b.signal);
  assert.ok(linked);
  assert.equal(linked.aborted, false);
  b.abort();
  assert.equal(linked.aborted, true);
});

test("timeoutSignal aborts after ms", async () => {
  const s = timeoutSignal(30);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(s.aborted, true);
});

test("withTimeout clears without aborting when clear() is called", async () => {
  const { signal, clear } = withTimeout(50);
  clear();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(signal.aborted, false);
});

test("CANCELLED_MESSAGE is stable for UI/API contract", () => {
  assert.equal(CANCELLED_MESSAGE, "Run cancelled.");
});
