import assert from "node:assert/strict";
import { test } from "node:test";
import { formatGroundingMarkdown, parseGrounding } from "./citations";

test("parseGrounding reads citations warnings and evidence links", () => {
  const g = parseGrounding({
    citations: [
      { kind: "url", text: "https://github.com/a/b", verified: true, url: "https://github.com/a/b" },
      { kind: "issue", text: "#9", verified: false },
    ],
    warnings: ["Unverified citations (not found in evidence): #9"],
    evidence_links: [{ label: "a/b", url: "https://github.com/a/b" }],
  });
  assert.ok(g);
  assert.equal(g.verifiedCount, 1);
  assert.equal(g.unverifiedCount, 1);
  assert.equal(g.evidenceLinks.length, 1);
});

test("parseGrounding returns null when empty", () => {
  assert.equal(parseGrounding({ pass: true }), null);
  assert.equal(parseGrounding(null), null);
});

test("formatGroundingMarkdown separates verified warnings and links", () => {
  const md = formatGroundingMarkdown({
    citations: [
      { kind: "repo", text: "a/b", verified: true, url: "https://github.com/a/b" },
      { kind: "issue", text: "#1", verified: false },
    ],
    warnings: ["Absolute claims without verified citations."],
    evidenceLinks: [{ label: "a/b", url: "https://github.com/a/b" }],
    verifiedCount: 1,
    unverifiedCount: 1,
  });
  assert.match(md, /Verified findings/);
  assert.match(md, /Warnings/);
  assert.match(md, /Evidence links/);
  assert.match(md, /\[a\/b\]\(https:\/\/github\.com\/a\/b\)/);
});
