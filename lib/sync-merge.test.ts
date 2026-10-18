import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeByIdAt } from "./sync-merge";

test("mergeByIdAt keeps newer at for same id", () => {
  const merged = mergeByIdAt(
    [
      { id: "a", at: 1, v: "local-old" },
      { id: "b", at: 5, v: "local-b" },
    ],
    [
      { id: "a", at: 10, v: "remote-a" },
      { id: "c", at: 3, v: "remote-c" },
    ],
    20,
  );
  assert.equal(merged.length, 3);
  assert.equal(merged[0]?.id, "a");
  assert.equal((merged[0] as { v: string }).v, "remote-a");
  assert.deepEqual(
    merged.map((x) => x.id),
    ["a", "b", "c"],
  );
});

test("mergeByIdAt caps and sorts by at desc", () => {
  const local = [
    { id: "1", at: 100 },
    { id: "2", at: 90 },
    { id: "3", at: 80 },
  ];
  const remote = [
    { id: "4", at: 95 },
    { id: "2", at: 70 },
  ];
  const merged = mergeByIdAt(local, remote, 3);
  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((x) => x.id),
    ["1", "4", "2"],
  );
  assert.equal(merged.find((x) => x.id === "2")?.at, 90);
});
