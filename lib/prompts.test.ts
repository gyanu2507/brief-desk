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
  assert.match(prompt, /brief_orchestrate/);
  assert.match(prompt, /Route selection/);
  assert.match(prompt, /Route: github/);
  assert.match(prompt, /Route: compare/);
  assert.match(prompt, /Route: followup/);
});

test("ui.json has demos and suggests", () => {
  const ui = loadUiConfig();
  assert.ok(ui.demos.length >= 3);
  assert.ok(ui.suggest.github.length >= 1);
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
