import type { Page, Route } from "@playwright/test";

const MCP_OK = {
  ok: true,
  mcp: "/mcp",
  version: "0.10.0",
  runtime: "python",
  ready: true,
  tools: [
    "brief_auto",
    "brief_plan",
    "brief_orchestrate",
    "brief_eval",
    "brief_corpus",
    "brief_github_trending",
  ],
};

export async function mockDeskApis(page: Page): Promise<void> {
  await page.route("**/api/mcp-health", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MCP_OK),
    });
  });

  await page.route("**/api/prompts", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ui: null, routes: [] }),
    });
  });
}

export function sseBriefResult(opts: {
  ok: boolean;
  answer?: string;
  error?: string;
  steps?: string[];
}): string {
  const steps = opts.steps || ["brief_auto", "draft", "brief_eval"];
  const chunks = [
    `data: ${JSON.stringify({ type: "start" })}\n\n`,
    ...steps.map((step, i) =>
      `data: ${JSON.stringify({ type: "step", step, steps: steps.slice(0, i + 1) })}\n\n`,
    ),
    `data: ${JSON.stringify({
      type: "result",
      ok: opts.ok,
      answer: opts.answer || "",
      steps,
      error: opts.error,
      ms: 42,
      eval: { pass: true, scores: { overall: 0.9 } },
    })}\n\n`,
  ];
  return chunks.join("");
}

export async function mockBriefRunSuccess(page: Page, answer: string): Promise<void> {
  await page.route("**/api/brief-run", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: sseBriefResult({ ok: true, answer }),
    });
  });
}

export async function mockBriefRunFailure(page: Page, error: string): Promise<void> {
  await page.route("**/api/brief-run", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: sseBriefResult({ ok: false, error, answer: "" }),
    });
  });
}
