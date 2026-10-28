import assert from "node:assert/strict";
import { test } from "node:test";
import { isSafeHref, safeHref } from "./safe-url";

test("isSafeHref allows http(s) and mailto", () => {
  assert.equal(isSafeHref("https://github.com/a/b"), true);
  assert.equal(isSafeHref("http://example.com"), true);
  assert.equal(isSafeHref("mailto:dev@example.com"), true);
});

test("isSafeHref blocks dangerous schemes", () => {
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("data:text/html,hi"), false);
  assert.equal(isSafeHref("vbscript:x"), false);
  assert.equal(safeHref("javascript:alert(1)"), undefined);
});
