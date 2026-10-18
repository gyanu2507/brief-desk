import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedSteps, stepsFromNames } from "./plan-steps";

test("expectedSteps for auto with brief_auto", () => {
  const steps = expectedSteps("auto", true);
  assert.equal(steps[0]?.label, "brief_auto");
  assert.ok(steps.some((s) => s.label === "brief_eval"));
});

test("expectedSteps for corpus", () => {
  const steps = expectedSteps("corpus", false);
  assert.equal(steps[0]?.label, "brief_corpus");
});

test("stepsFromNames marks done", () => {
  const steps = stepsFromNames(["brief_auto", "draft", "brief_eval"]);
  assert.equal(steps.length, 3);
  assert.ok(steps.every((s) => s.state === "done"));
});
