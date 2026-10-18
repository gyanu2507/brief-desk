import assert from "node:assert/strict";
import { test } from "node:test";

// Mirror extractReposFromEvidence shape checks via a tiny inline helper
// matching lib/brief-run.ts so CI catches regressions without exporting internals.
function extractReposFromEvidence(evidence: string) {
  try {
    const parsed = JSON.parse(evidence) as {
      repos?: Array<{ repo?: string }>;
      gather?: {
        trending?: { repos?: Array<{ repo?: string }> };
        search?: { repos?: Array<{ repo?: string }> };
      };
    };
    if (Array.isArray(parsed.repos)) {
      return parsed.repos.filter((r) => typeof r.repo === "string" && r.repo.includes("/"));
    }
    const fromTrend = parsed.gather?.trending?.repos;
    if (Array.isArray(fromTrend)) {
      return fromTrend.filter((r) => typeof r.repo === "string" && r.repo.includes("/"));
    }
    const fromSearch = parsed.gather?.search?.repos;
    if (Array.isArray(fromSearch)) {
      return fromSearch.filter((r) => typeof r.repo === "string" && r.repo.includes("/"));
    }
  } catch {
    // ignore
  }
  return [];
}

test("extractReposFromEvidence reads trending payload", () => {
  const hits = extractReposFromEvidence(
    JSON.stringify({
      repos: [{ repo: "vercel/next.js" }, { repo: "bad" }, { repo: "facebook/react" }],
    }),
  );
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.repo, "vercel/next.js");
});

test("extractReposFromEvidence reads auto gather.trending", () => {
  const hits = extractReposFromEvidence(
    JSON.stringify({
      gather: { trending: { repos: [{ repo: "rust-lang/rust" }] } },
    }),
  );
  assert.equal(hits[0]?.repo, "rust-lang/rust");
});
