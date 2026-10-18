import assert from "node:assert/strict";
import { test } from "node:test";
import { historyLabel, pushBriefHistory } from "./brief-history";

test("historyLabel prefers goal for auto", () => {
  assert.match(
    historyLabel({
      source: "auto",
      goal: "Brief facebook/react risks for an eng manager.",
      question: "q",
    }),
    /facebook\/react/,
  );
});

test("pushBriefHistory prepends and caps", () => {
  const base = Array.from({ length: 22 }, (_, i) => ({
    id: `h-${i}`,
    at: i,
    source: "github" as const,
    mode: "overview" as const,
    label: `item ${i}`,
    question: `q${i}`,
    answer: `a${i}`,
    markdown: `md-${i}`,
  }));
  const next = pushBriefHistory(base, {
    source: "trending",
    mode: "general",
    label: "new",
    question: "q",
    answer: "a",
    markdown: "md-new",
  });
  assert.equal(next[0]?.markdown, "md-new");
  assert.equal(next.length, 20);
});
