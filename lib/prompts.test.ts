import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadAgentSystemPrompt,
  loadUiConfig,
  renderStartBrief,
  renderTemplate,
} from "./prompts";

test("renderTemplate fills vars and drops incomplete lines", () => {
  const out = renderTemplate("a={{a}}\n{{missing_line}}\nb={{b}}", {
    a: "1",
    b: "2",
  });
  assert.equal(out, "a=1\nb=2");
});

test("agent prompt includes router and route keys", () => {
  const prompt = loadAgentSystemPrompt();
  assert.match(prompt, /brief_auto/);
  assert.match(prompt, /brief_eval/);
  assert.match(prompt, /Hard bans/);
  assert.match(prompt, /Route selection/);
  assert.match(prompt, /Route: auto/);
  assert.match(prompt, /Route: github/);
  assert.match(prompt, /Route: compare/);
  assert.match(prompt, /Route: trending/);
  assert.match(prompt, /Route: followup/);
  assert.match(prompt, /brief_github_trending/);
});

test("ui.json has auto demos and suggests", () => {
  const ui = loadUiConfig();
  assert.ok(ui.demos.some((d) => d.source === "auto"));
  assert.ok(ui.demos.some((d) => d.source === "trending"));
  assert.ok(ui.suggest.auto.length >= 1);
  assert.ok(ui.suggest.github.length >= 1);
  assert.ok(ui.suggest.trending.length >= 1);
});

test("start-brief template renders session fields", () => {
  const content = renderStartBrief({
    source: "github",
    mode: "risks",
    repo: "facebook/react",
    question: "What are the risks?",
  });
  assert.match(content, /source=github/);
  assert.match(content, /mode=risks/);
  assert.match(content, /repo=facebook\/react/);
  assert.match(content, /Question: What are the risks\?/);
  assert.doesNotMatch(content, /repo_b=/);
});

test("auto-brief template renders free-form goal", () => {
  const content = renderStartBrief({
    source: "auto",
    mode: "general",
    question: "Brief facebook/react risks",
    goal: "Brief facebook/react risks",
  });
  assert.match(content, /source=auto/);
  assert.match(content, /Goal: Brief facebook\/react risks/);
  assert.match(content, /brief_auto/);
  assert.match(content, /Tool sequence/);
});
