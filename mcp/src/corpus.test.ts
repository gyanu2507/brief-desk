import assert from "node:assert/strict";
import { test } from "node:test";
import { searchCorpus } from "./corpus";

test("bundled corpus finds checkout promo", () => {
  const pack = searchCorpus("What is the checkout promo about?");
  assert.ok(pack.hits.length >= 1);
  assert.ok(pack.hits.some((h) => /checkout/i.test(h.path)));
});

test("bundled corpus finds billing refunds", () => {
  const pack = searchCorpus("refunds negative rows billing");
  assert.ok(pack.hits.some((h) => /billing/i.test(h.path) || /refund/i.test(h.excerpt)));
});
