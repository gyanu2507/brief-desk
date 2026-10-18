import assert from "node:assert/strict";
import { test } from "node:test";
import { filterLocalSuggestions, normalizeRepoQuery } from "./repo-suggest";

test("normalizeRepoQuery strips github urls", () => {
  assert.equal(
    normalizeRepoQuery("https://github.com/facebook/react.git"),
    "facebook/react",
  );
});

test("filterLocalSuggestions matches react", () => {
  const hits = filterLocalSuggestions("react", [], 5);
  assert.ok(hits.some((h) => h.repo === "facebook/react"));
});

test("filterLocalSuggestions prefers saved", () => {
  const hits = filterLocalSuggestions("acme", [{ repo: "acme/widgets", source: "saved" }], 5);
  assert.equal(hits[0]?.repo, "acme/widgets");
});
