export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mcpUrl = process.env.MCP_URL || "http://127.0.0.1:3108/mcp";
  const healthUrl = mcpUrl.replace(/\/mcp\/?$/, "/health");
  try {
    // Long enough for a sleeping free-tier backend to start. The page polls
    // again on failure.
    const res = await fetch(healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await res.json()) as Record<string, unknown>;
    return Response.json(
      {
        ok: res.ok && body.ok === true,
        healthUrl,
        ...body,
      },
      { status: res.ok ? 200 : 502 },
    );
  } catch (e) {
    return Response.json(
      {
        ok: false,
        healthUrl,
        error: e instanceof Error ? e.message : "health fetch failed",
      },
      { status: 502 },
    );
  }
}
