import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatMessagesFromHistory,
  messageRole,
  messageText,
  normalizeRepo,
  normalizeUrl,
} from "./desk-session";

test("normalizeRepo accepts owner/name and GitHub URLs, rejects the rest", () => {
  assert.equal(normalizeRepo(" facebook/react "), "facebook/react");
  assert.equal(normalizeRepo("https://github.com/vercel/next.js.git"), "vercel/next.js");
  assert.equal(normalizeRepo("react"), null);
  assert.equal(normalizeRepo("a/b/c"), null);
});

test("normalizeUrl only keeps http and https URLs", () => {
  assert.equal(normalizeUrl("https://zod.dev"), "https://zod.dev/");
  assert.equal(normalizeUrl("ftp://example.com"), null);
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("not a url"), null);
});

test("messageText joins string and text-part content", () => {
  assert.equal(messageText({ content: "hi" }), "hi");
  assert.equal(messageText({ content: ["a", { text: "b" }, { other: 1 }] }), "ab");
  assert.equal(messageText(null), "");
  assert.equal(messageRole({ role: "Assistant" }), "assistant");
});

test("chatMessagesFromHistory rebuilds a user and assistant pair", () => {
  const out = chatMessagesFromHistory({
    id: "x1",
    at: 42,
    question: "Brief zod",
    markdown: "# zod",
  } as Parameters<typeof chatMessagesFromHistory>[0]);
  assert.equal(out.question, "Brief zod");
  assert.deepEqual(
    out.messages.map((m) => [m.role, m.content, m.id]),
    [
      ["user", "Brief zod", "hist-u-x1-42"],
      ["assistant", "# zod", "hist-a-x1-42"],
    ],
  );
});
