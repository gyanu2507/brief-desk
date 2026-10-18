import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3119;

test("MCP health and root come up", async () => {
  const child = spawn("npx", ["tsx", "mcp/src/server.ts"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, MCP_PORT: String(PORT), PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/health`);
        if (res.ok) {
          const body = (await res.json()) as { ok: boolean; mcp: string; version?: string; tools?: string[] };
          assert.equal(body.ok, true);
          assert.equal(body.mcp, "/mcp");
          assert.equal(body.version, "0.5.1");
          assert.ok(body.tools?.includes("brief_auto"));
          assert.ok(body.tools?.includes("brief_plan"));
          assert.ok(body.tools?.includes("brief_orchestrate"));
          assert.ok(body.tools?.includes("brief_eval"));
          assert.ok(body.tools?.includes("brief_fetch_url"));
          ready = true;
          break;
        }
      } catch {
        // still booting
      }
    }
    assert.equal(ready, true, "MCP health did not become ready");

    const root = await fetch(`http://127.0.0.1:${PORT}/`);
    assert.equal(root.status, 200);
    const html = await root.text();
    assert.match(html, /brief-desk MCP/);

    const mcpGet = await fetch(`http://127.0.0.1:${PORT}/mcp`);
    assert.equal(mcpGet.status, 405);
  } finally {
    child.kill("SIGTERM");
  }
});
