import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAutonomousPlan, classifyBriefMode } from "./plan";

test("classifyBriefMode detects compare and risks", () => {
  assert.equal(classifyBriefMode("compare next vs remix"), "compare");
  assert.equal(classifyBriefMode("what are the biggest risks?"), "risks");
});

test("buildAutonomousPlan invents github risks plan", () => {
  const plan = buildAutonomousPlan("Brief facebook/react risks for an eng manager");
  const invented = plan.invented as {
    source_kind: string;
    mode: string;
    repo: string | null;
    subgoals: string[];
  };
  assert.equal(invented.source_kind, "github");
  assert.equal(invented.mode, "risks");
  assert.equal(invented.repo, "facebook/react");
  assert.ok(invented.subgoals.length >= 1);
  assert.match(String(plan.next), /Execute tool_steps/);
  assert.ok((plan.tool_steps as string[]).some((s) => s.includes("brief_auto")));
});

test("buildAutonomousPlan invents compare targets", () => {
  const plan = buildAutonomousPlan(
    "Compare vercel/next.js vs remix-run/remix for a production SaaS frontend",
  );
  const invented = plan.invented as {
    source_kind: string;
    mode: string;
    repo: string | null;
    repo_b: string | null;
  };
  assert.equal(invented.source_kind, "compare");
  assert.equal(invented.mode, "compare");
  assert.equal(invented.repo, "vercel/next.js");
  assert.equal(invented.repo_b, "remix-run/remix");
});

test("buildAutonomousPlan invents url source", () => {
  const plan = buildAutonomousPlan(
    "Summarize https://modelcontextprotocol.io/introduction for an MCP author",
  );
  const invented = plan.invented as { source_kind: string; url: string | null; mode: string };
  assert.equal(invented.source_kind, "url");
  assert.equal(invented.url, "https://modelcontextprotocol.io/introduction");
});
