import assert from "node:assert/strict";
import { test } from "node:test";
import { runBriefPipeline } from "./brief-run";

test(
  "brief-run auto pipeline returns a non-empty answer",
  { timeout: 120_000 },
  async () => {
    process.env.MCP_URL = process.env.MCP_URL || "https://brief-desk.onrender.com/mcp";
    if (!process.env.OPENAI_API_KEY) {
      const { readFileSync } = await import("node:fs");
      try {
        const env = readFileSync(".env.local", "utf8");
        for (const line of env.split("\n")) {
          if (!line || line.startsWith("#") || !line.includes("=")) continue;
          const i = line.indexOf("=");
          const k = line.slice(0, i);
          const v = line.slice(i + 1);
          if (!process.env[k]) process.env[k] = v;
        }
      } catch {
        // skip if missing
      }
    }
    if (!process.env.OPENAI_API_KEY) {
      console.log("skip: no OPENAI_API_KEY");
      return;
    }

    const result = await runBriefPipeline({
      source: "auto",
      question: "Brief facebook/react risks for an eng manager.",
      goal: "Brief facebook/react risks for an eng manager.",
    });
    assert.equal(result.ok, true, result.error || "expected ok");
    assert.ok(result.answer.length > 80, "answer too short");
    assert.ok(result.steps.includes("draft"));
    assert.ok(result.steps.includes("brief_eval") || result.steps.includes("brief_auto"));
  },
);
