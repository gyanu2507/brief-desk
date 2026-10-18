import { NextResponse } from "next/server";
import { callMcpTool } from "../../../lib/mcp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ReleaseTag = {
  tag: string;
  name?: string | null;
  published_at?: string | null;
  prerelease?: boolean;
  url?: string | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = (url.searchParams.get("repo") || "").trim();
  const max = Math.min(30, Math.max(1, Number(url.searchParams.get("max") || 20) || 20));
  if (!repo.includes("/")) {
    return NextResponse.json(
      { ok: false, error: "repo must be owner/name", releases: [] },
      { status: 400 },
    );
  }

  const mcp = await callMcpTool(
    "brief_repo_releases",
    { repo, max_results: max },
    { timeoutMs: 25_000 },
  );
  if (!mcp.ok) {
    return NextResponse.json(
      { ok: false, error: mcp.error || "releases failed", releases: [] },
      { status: 502 },
    );
  }

  try {
    const parsed = JSON.parse(mcp.text) as {
      repo?: string;
      releases?: ReleaseTag[];
      error?: string;
    };
    const releases = (parsed.releases || []).filter(
      (r) => typeof r.tag === "string" && r.tag.trim().length > 0,
    );
    return NextResponse.json({
      ok: releases.length > 0 && !parsed.error,
      repo: parsed.repo || repo,
      releases,
      error: parsed.error,
      ms: mcp.ms,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad releases payload", releases: [] },
      { status: 502 },
    );
  }
}
