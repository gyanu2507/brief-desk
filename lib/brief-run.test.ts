import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { runBriefPipeline } from "./brief-run";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3128;

async function loadEnvLocal() {
  if (process.env.OPENAI_API_KEY) return;
  const { readFileSync } = await import("node:fs");
  try {
    const env = readFileSync(path.join(ROOT, ".env.local"), "utf8");
    for (const line of env.split("\n")) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i);
      const v = line.slice(i + 1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // ignore
  }
}

async function startLocalMcp(): Promise<ChildProcess> {
  const child = spawn("uv", ["run", "python", "-m", "brief_desk_mcp"], {
    cwd: path.join(ROOT, "backend"),
    env: {
      ...process.env,
      MCP_PORT: String(PORT),
      PORT: String(PORT),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return child;
    } catch {
      // booting
    }
  }
  child.kill("SIGTERM");
  throw new Error("local Python MCP failed to start");
}

test(
  "brief-run auto pipeline returns a non-empty answer",
  { timeout: 120_000 },
  async () => {
    await loadEnvLocal();
    if (!process.env.OPENAI_API_KEY) {
      console.log("skip: no OPENAI_API_KEY");
      return;
    }

    const child = await startLocalMcp();
    process.env.MCP_URL = `http://127.0.0.1:${PORT}/mcp`;
    try {
      const result = await runBriefPipeline({
        source: "auto",
        question: "Brief facebook/react risks for an eng manager.",
        goal: "Brief facebook/react risks for an eng manager.",
      });
      assert.equal(result.ok, true, result.error || "expected ok");
      assert.ok(result.answer.length > 80, "answer too short");
      assert.ok(result.steps.includes("draft"));
      assert.ok(result.steps.includes("brief_eval") || result.steps.includes("brief_auto"));
    } finally {
      child.kill("SIGTERM");
    }
  },
);
