import { NextResponse } from "next/server";
import { callMcpTool } from "../../../lib/mcp-client";
import {
  fetchGithubTrending,
  isMcpToolMissing,
  type TrendingRepo,
} from "../../../lib/github-trending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { TrendingRepo };

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

  if (mcp.ok) {
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
        via: "mcp",
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

  // Stale MCP (e.g. Render still on 0.6.0) or unreachable: scrape GitHub directly.
  if (isMcpToolMissing(mcp.error) || mcp.error) {
    try {
      const t0 = Date.now();
      const scraped = await fetchGithubTrending({
        language,
        since,
        maxResults: max,
      });
      return NextResponse.json({
        ok: scraped.repos.length > 0,
        via: "direct",
        trending_url: scraped.url,
        since: scraped.since,
        language: scraped.language || language || "any",
        repos: scraped.repos,
        error: scraped.repos.length
          ? undefined
          : scraped.error || mcp.error || "trending failed",
        mcp_error: mcp.error,
        ms: Date.now() - t0,
      });
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: e instanceof Error ? e.message : mcp.error || "trending failed",
          repos: [],
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    { ok: false, error: mcp.error || "trending failed", repos: [] },
    { status: 502 },
  );
}
