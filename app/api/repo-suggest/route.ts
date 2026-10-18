import { NextResponse } from "next/server";
import { callMcpTool } from "../../../lib/mcp-client";
import {
  filterLocalSuggestions,
  normalizeRepoQuery,
  type RepoSuggestion,
} from "../../../lib/repo-suggest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function searchGithub(query: string): Promise<RepoSuggestion[]> {
  const q = normalizeRepoQuery(query);
  if (q.length < 2) return [];

  // Prefer MCP when available (same auth as the rest of the desk).
  const mcp = await callMcpTool(
    "brief_github_search",
    { query: q, sort: "stars", max_results: 8 },
    { timeoutMs: 8_000 },
  );
  if (mcp.ok) {
    try {
      const parsed = JSON.parse(mcp.text) as {
        repos?: Array<{
          repo?: string;
          description?: string | null;
          stars?: number | null;
        }>;
      };
      return (parsed.repos || [])
        .filter((r) => typeof r.repo === "string" && r.repo.includes("/"))
        .map((r) => ({
          repo: r.repo as string,
          description: r.description ?? null,
          stars: typeof r.stars === "number" ? r.stars : null,
          source: "github" as const,
        }));
    } catch {
      // fall through
    }
  }

  // Direct GitHub Search API fallback.
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "brief-desk",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const searchQ = q.includes("/") ? `${q} in:name` : q;
  const res = await fetch(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQ)}&sort=stars&order=desc&per_page=8`,
    { headers, signal: AbortSignal.timeout(8_000) },
  );
  if (!res.ok) return [];
  const body = (await res.json()) as {
    items?: Array<{
      full_name?: string;
      description?: string | null;
      stargazers_count?: number;
    }>;
  };
  return (body.items || [])
    .filter((it) => typeof it.full_name === "string")
    .map((it) => ({
      repo: it.full_name as string,
      description: it.description ?? null,
      stars: typeof it.stargazers_count === "number" ? it.stargazers_count : null,
      source: "github" as const,
    }));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = normalizeRepoQuery(url.searchParams.get("q") || "");
  const local = filterLocalSuggestions(q, [], 6);

  if (q.length < 2) {
    return NextResponse.json({ ok: true, query: q, suggestions: local });
  }

  try {
    const remote = await searchGithub(q);
    const seen = new Set(local.map((s) => s.repo.toLowerCase()));
    const merged = [...local];
    for (const item of remote) {
      const key = item.repo.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= 10) break;
    }
    return NextResponse.json({ ok: true, query: q, suggestions: merged });
  } catch (e) {
    return NextResponse.json({
      ok: true,
      query: q,
      suggestions: local,
      warning: e instanceof Error ? e.message : "remote search failed",
    });
  }
}
