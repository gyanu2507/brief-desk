import assert from "node:assert/strict";
import { test } from "node:test";
import { FALLBACK_UI } from "./fallback-ui";

test("fallback UI has auto demos and never-empty suggests", () => {
  assert.ok(FALLBACK_UI.demos.some((d) => d.source === "auto"));
  assert.ok(FALLBACK_UI.suggest.auto.length >= 1);
  assert.match(FALLBACK_UI.sessionNotes.auto, /brief_workspace/);
});
