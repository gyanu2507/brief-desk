import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBriefMarkdown } from "./format-brief";

test("formatBriefMarkdown promotes Plan and sections", () => {
  const out = formatBriefMarkdown(
    "Plan: github · risks · facebook/react\n\nRisks\n- Open issue #1\n",
    "brief_auto → draft · 1200ms",
  );
  assert.match(out, /\*\*Plan:\*\*/);
  assert.match(out, /### Risks/);
  assert.match(out, /brief_auto/);
});
