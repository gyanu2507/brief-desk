import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSessionSearch,
  buildSessionUrl,
  parseSessionSearch,
} from "./session-link";

test("parseSessionSearch requires source", () => {
  assert.equal(parseSessionSearch("repo=facebook/react"), null);
  assert.equal(parseSessionSearch(""), null);
});

test("roundtrip auto goal", () => {
  const q = buildSessionSearch({
    source: "auto",
    goal: "Brief facebook/react risks",
  });
  const parsed = parseSessionSearch(q);
  assert.equal(parsed?.source, "auto");
  assert.equal(parsed?.goal, "Brief facebook/react risks");
});

test("roundtrip package and releases", () => {
  const pkg = parseSessionSearch(
    buildSessionSearch({
      source: "package",
      packageRegistry: "npm",
      packageName: "zod",
    }),
  );
  assert.equal(pkg?.packageRegistry, "npm");
  assert.equal(pkg?.packageName, "zod");

  const rel = parseSessionSearch(
    buildSessionSearch({
      source: "releases",
      repo: "vercel/next.js",
      tagA: "v14.2.0",
      tagB: "v15.0.0",
    }),
  );
  assert.equal(rel?.repo, "vercel/next.js");
  assert.equal(rel?.tagA, "v14.2.0");
  assert.equal(rel?.tagB, "v15.0.0");
});

test("buildSessionUrl joins origin and query", () => {
  const url = buildSessionUrl("https://example.com", "/", {
    source: "github",
    mode: "risks",
    repo: "facebook/react",
  });
  assert.equal(
    url,
    "https://example.com/?source=github&mode=risks&repo=facebook%2Freact",
  );
});
