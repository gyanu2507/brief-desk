import assert from "node:assert/strict";
import { test } from "node:test";
import { ConcurrencyGate, rateLimit, resetRateLimitBuckets } from "./rate-limit";

test("rateLimit allows up to limit then blocks", () => {
  resetRateLimitBuckets();
  const key = "t1";
  const windowMs = 10_000;
  assert.equal(rateLimit({ key, limit: 2, windowMs, now: 1000 }).ok, true);
  assert.equal(rateLimit({ key, limit: 2, windowMs, now: 1001 }).ok, true);
  const blocked = rateLimit({ key, limit: 2, windowMs, now: 1002 });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.ok(blocked.retryAfterSec >= 1);
});

test("rateLimit window slides", () => {
  resetRateLimitBuckets();
  const key = "t2";
  assert.equal(rateLimit({ key, limit: 1, windowMs: 100, now: 0 }).ok, true);
  assert.equal(rateLimit({ key, limit: 1, windowMs: 100, now: 50 }).ok, false);
  assert.equal(rateLimit({ key, limit: 1, windowMs: 100, now: 101 }).ok, true);
});

test("ConcurrencyGate queues beyond max", async () => {
  const gate = new ConcurrencyGate(1);
  const release1 = await gate.acquire();
  let secondStarted = false;
  const pending = gate.acquire().then((release) => {
    secondStarted = true;
    release();
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(secondStarted, false);
  assert.equal(gate.queued, 1);
  release1();
  await pending;
  assert.equal(secondStarted, true);
  assert.equal(gate.running, 0);
});
