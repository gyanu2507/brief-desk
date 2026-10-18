export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mcpUrl = process.env.MCP_URL || "http://127.0.0.1:3108/mcp";
  const healthUrl = mcpUrl.replace(/\/mcp\/?$/, "/health");
  try {
    const res = await fetch(healthUrl, { cache: "no-store" });
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
