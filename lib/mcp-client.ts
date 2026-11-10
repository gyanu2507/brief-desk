import {
  isAbortError,
  throwIfAborted,
  withTimeout,
  TIMEOUT_MESSAGE,
} from "./abort";

type RpcResult = {
  ok: boolean;
  text: string;
  error?: string;
  ms: number;
  cancelled?: boolean;
  timedOut?: boolean;
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
  opts?: { mcpUrl?: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<RpcResult> {
  const mcpUrl = opts?.mcpUrl || process.env.MCP_URL || "http://127.0.0.1:3108/mcp";
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const t0 = Date.now();
  const { signal, clear } = withTimeout(timeoutMs, opts?.signal);

  try {
    throwIfAborted(opts?.signal);

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
      signal,
    });
    const sid = initRes.headers.get("mcp-session-id") || undefined;
    await initRes.text();

    throwIfAborted(opts?.signal);

    await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(sid ? { "mcp-session-id": sid } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      signal,
    });

    throwIfAborted(opts?.signal);

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
      signal,
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
    if (isAbortError(e)) {
      const timedOut = opts?.signal ? !opts.signal.aborted : true;
      return {
        ok: false,
        text: "",
        error: timedOut ? TIMEOUT_MESSAGE : "MCP call cancelled",
        ms: Date.now() - t0,
        cancelled: !timedOut,
        timedOut,
      };
    }
    return {
      ok: false,
      text: "",
      error: e instanceof Error ? e.message : "MCP call failed",
      ms: Date.now() - t0,
    };
  } finally {
    clear();
  }
}

export function mcpHealthUrl(mcpUrl: string): string {
  return mcpUrl.replace(/\/mcp\/?$/, "/health");
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export type WakeResult = { waited: boolean; ok: boolean; ms: number; error?: string };

/**
 * Wait for a remote MCP backend that may be asleep (Render free tier spins
 * down after 15 idle minutes and takes a while to come back).
 *
 * Returns at once for local URLs or when the first quick health check passes.
 * Otherwise calls onWaking once and polls /health until budgetMs runs out.
 */
export async function waitForMcp(opts?: {
  mcpUrl?: string;
  signal?: AbortSignal;
  quickMs?: number;
  budgetMs?: number;
  pollMs?: number;
  onWaking?: () => void;
  fetchImpl?: typeof fetch;
}): Promise<WakeResult> {
  const mcpUrl = opts?.mcpUrl || process.env.MCP_URL || "http://127.0.0.1:3108/mcp";
  const doFetch = opts?.fetchImpl ?? fetch;
  const t0 = Date.now();
  if (isLocalUrl(mcpUrl)) return { waited: false, ok: true, ms: 0 };

  const healthUrl = mcpHealthUrl(mcpUrl);
  const quickMs = opts?.quickMs ?? 4_000;
  const budgetMs = opts?.budgetMs ?? 75_000;
  const pollMs = opts?.pollMs ?? 2_000;
  let lastError = "no response";

  const check = async (ms: number): Promise<boolean> => {
    const { signal, clear } = withTimeout(ms, opts?.signal);
    try {
      const res = await doFetch(healthUrl, { cache: "no-store", signal });
      if (res.ok) return true;
      lastError = `health returned HTTP ${res.status}`;
      return false;
    } catch (e) {
      throwIfAborted(opts?.signal);
      lastError = isAbortError(e) ? "health check timed out" : e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      clear();
    }
  };

  if (await check(quickMs)) return { waited: false, ok: true, ms: Date.now() - t0 };

  opts?.onWaking?.();
  while (Date.now() - t0 < budgetMs) {
    const left = budgetMs - (Date.now() - t0);
    if (await check(Math.max(1_000, left))) return { waited: true, ok: true, ms: Date.now() - t0 };
    throwIfAborted(opts?.signal);
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { waited: true, ok: false, ms: Date.now() - t0, error: lastError };
}
