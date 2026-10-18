import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 3119;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Python MCP health and root come up", async () => {
  const child = spawn("uv", ["run", "python", "-m", "brief_desk_mcp"], {
    cwd: path.join(ROOT, "backend"),
    env: { ...process.env, MCP_PORT: String(PORT), PORT: String(PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    let ready = false;
    let lastErr = "";
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/health`);
        if (res.ok) {
          const body = (await res.json()) as {
            ok: boolean;
            mcp: string;
            version?: string;
            runtime?: string;
            tools?: string[];
            ready?: boolean;
          };
          assert.equal(body.ok, true);
          assert.equal(body.mcp, "/mcp");
          assert.equal(body.runtime, "python");
          assert.equal(body.version, "0.9.0");
          assert.equal(body.ready, true);
          assert.ok(body.tools?.includes("brief_auto"));
          assert.ok(body.tools?.includes("brief_plan"));
          assert.ok(body.tools?.includes("brief_orchestrate"));
          assert.ok(body.tools?.includes("brief_eval"));
          assert.ok(body.tools?.includes("brief_fetch_url"));
          assert.ok(body.tools?.includes("brief_web_search"));
          assert.ok(body.tools?.includes("brief_github_trending"));
          assert.ok(body.tools?.includes("brief_github_search"));
          assert.ok(body.tools?.includes("brief_repo_releases"));
          assert.ok(body.tools?.includes("brief_repo_security"));
          assert.ok(body.tools?.includes("brief_corpus"));
          assert.ok(!body.tools?.includes("brief_workspace"));
          ready = true;
          break;
        }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    assert.equal(ready, true, `MCP health did not become ready (${lastErr})`);

    const root = await fetch(`http://127.0.0.1:${PORT}/`);
    assert.equal(root.status, 200);
    const html = await root.text();
    assert.match(html, /brief-desk MCP/);
    assert.match(html, /Python/);
  } finally {
    child.kill("SIGTERM");
  }
});
