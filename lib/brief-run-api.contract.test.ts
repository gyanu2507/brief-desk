import assert from "node:assert/strict";
import { test } from "node:test";
import { CANCELLED_MESSAGE } from "./abort";
import { POST } from "../app/api/brief-run/route";

function jsonRequest(body: unknown, init?: { signal?: AbortSignal; accept?: string }) {
  return new Request("http://127.0.0.1/api/brief-run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: init?.accept || "application/json",
    },
    body: JSON.stringify(body),
    signal: init?.signal,
  });
}

test("POST /api/brief-run rejects missing source", async () => {
  const res = await POST(jsonRequest({ question: "Need a longer question here" }));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { ok?: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.match(body.error || "", /required/i);
});

test("POST /api/brief-run rejects missing question", async () => {
  const res = await POST(jsonRequest({ source: "corpus" }));
  assert.equal(res.status, 400);
});

test("POST /api/brief-run returns cancelled when request signal is aborted", async () => {
  const ac = new AbortController();
  ac.abort();
  const res = await POST(
    jsonRequest(
      { source: "corpus", question: "What lives in the bundled corpus?" },
      { signal: ac.signal },
    ),
  );
  const body = (await res.json()) as { ok?: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, CANCELLED_MESSAGE);
  assert.equal(res.status, 499);
});
