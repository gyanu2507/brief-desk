import assert from "node:assert/strict";
import { test } from "node:test";
import { formatEvalMarkdown, parseEvalView } from "./eval-display";

test("parseEvalView reads scores pass revisions and limitations", () => {
  const view = parseEvalView({
    pass: true,
    scores: { groundedness: 0.8, completeness: 0.7, citation: 0.9, overall: 78 },
    revisions: ["Ship as-is."],
    note: "Heuristic note",
  });
  assert.ok(view);
  assert.equal(view.pass, true);
  assert.equal(view.scores?.overall, 78);
  assert.ok(view.limitations.length >= 2);
});

test("formatEvalMarkdown includes limitations", () => {
  const md = formatEvalMarkdown({
    pass: false,
    scores: { groundedness: 0.4, completeness: 0.5, citation: 0.2, overall: 40 },
    revisions: ["Add citations."],
    note: "Heuristic",
    limitations: ["Heuristic rubric only: no paid LLM-as-judge."],
  });
  assert.match(md, /needs revision/);
  assert.match(md, /Limitations/);
  assert.match(md, /Add citations/);
});
