import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isKnownLanguage,
  THEME_OPTIONS,
  TRENDING_LANGUAGES,
  TRENDING_SINCE,
} from "./select-options";

test("trending languages include any + typescript", () => {
  assert.ok(TRENDING_LANGUAGES.some((o) => o.value === ""));
  assert.ok(TRENDING_LANGUAGES.some((o) => o.value === "typescript"));
  assert.ok(TRENDING_LANGUAGES.length >= 15);
});

test("trending since has three windows", () => {
  assert.deepEqual(
    TRENDING_SINCE.map((o) => o.value),
    ["daily", "weekly", "monthly"],
  );
});

test("isKnownLanguage accepts listed values", () => {
  assert.equal(isKnownLanguage(""), true);
  assert.equal(isKnownLanguage("python"), true);
  assert.equal(isKnownLanguage("made-up-lang"), false);
});

test("theme options cover light dark system", () => {
  assert.deepEqual(
    THEME_OPTIONS.map((o) => o.value),
    ["system", "light", "dark"],
  );
});
