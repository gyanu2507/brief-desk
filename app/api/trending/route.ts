import { NextResponse } from "next/server";
import { callMcpTool } from "../../../lib/mcp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type TrendingRepo = {
  repo: string;
  url?: string;
  description?: string | null;
  stars_delta?: string | null;
  stars_period?: string | null;
  language?: string | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const language = (url.searchParams.get("language") || "").trim() || undefined;
  const since = (url.searchParams.get("since") || "weekly").trim();
  const max = Math.min(15, Math.max(1, Number(url.searchParams.get("max") || 10) || 10));

  const mcp = await callMcpTool(
    "brief_github_trending",
    { language, since, max_results: max },
    { timeoutMs: 20_000 },
  );
  if (!mcp.ok) {
    return NextResponse.json(
      { ok: false, error: mcp.error || "trending failed", repos: [] },
      { status: 502 },
    );
  }

  try {
    const parsed = JSON.parse(mcp.text) as {
      url?: string;
      since?: string;
      language?: string;
      repos?: TrendingRepo[];
      error?: string;
    };
    const repos = (parsed.repos || []).filter(
      (r) => typeof r.repo === "string" && r.repo.includes("/"),
    );
    return NextResponse.json({
      ok: true,
      trending_url: parsed.url,
      since: parsed.since || since,
      language: parsed.language || language || "any",
      repos,
      error: parsed.error,
      ms: mcp.ms,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad trending payload", repos: [] },
      { status: 502 },
    );
  }
}
