type RpcResult = {
  ok: boolean;
  text: string;
  error?: string;
  ms: number;
};

function parseSseJson(raw: string): unknown {
  const line = raw.split("\n").find((l) => l.startsWith("data: "));
  if (!line) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return JSON.parse(line.slice(6));
}

/** Minimal Streamable HTTP MCP client for server-side brief-run. */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  opts?: { mcpUrl?: string; timeoutMs?: number },
): Promise<RpcResult> {
  const mcpUrl = opts?.mcpUrl || process.env.MCP_URL || "http://127.0.0.1:3108/mcp";
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const initRes = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "brief-desk-api", version: "0.1.0" },
        },
      }),
      signal: controller.signal,
    });
    const sid = initRes.headers.get("mcp-session-id") || undefined;
    await initRes.text();

    await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(sid ? { "mcp-session-id": sid } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      signal: controller.signal,
    });

    const callRes = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(sid ? { "mcp-session-id": sid } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: controller.signal,
    });
    const raw = await callRes.text();
    const json = parseSseJson(raw) as {
      error?: { message?: string };
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    } | null;
    if (!json) {
      return { ok: false, text: "", error: "empty MCP response", ms: Date.now() - t0 };
    }
    if (json.error) {
      return {
        ok: false,
        text: "",
        error: json.error.message || "MCP error",
        ms: Date.now() - t0,
      };
    }
    const text = json.result?.content?.[0]?.text || "";
    return {
      ok: !json.result?.isError,
      text,
      error: json.result?.isError ? text.slice(0, 400) : undefined,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      text: "",
      error: e instanceof Error ? e.message : "MCP call failed",
      ms: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}
