"use client";

import { useEffect, useState } from "react";

export type McpHealth = {
  /** null while the first check is in flight, then whether /health said ok. */
  mcpOk: boolean | null;
  /** True once the first check has been pending for a few seconds. */
  mcpSlow: boolean;
  mcpVersion: string;
  mcpTools: string[];
};

/** Poll /api/mcp-health: every 5 s while the backend is down, 20 s once up. */
export function useMcpHealth(): McpHealth {
  const [mcpOk, setMcpOk] = useState<boolean | null>(null);
  const [mcpSlow, setMcpSlow] = useState(false);
  const [mcpVersion, setMcpVersion] = useState<string>("");
  const [mcpTools, setMcpTools] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    // The free-tier backend can take up to a minute to wake. If the first
    // health check is still pending after a few seconds, say so.
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setMcpSlow(true);
    }, 3_000);
    const ping = async () => {
      let ok = false;
      try {
        const res = await fetch("/api/mcp-health", { cache: "no-store" });
        const body = (await res.json()) as {
          ok?: boolean;
          version?: string;
          tools?: string[];
        };
        ok = Boolean(body.ok);
        if (!cancelled) {
          setMcpOk(ok);
          setMcpVersion(typeof body.version === "string" ? body.version : "");
          setMcpTools(Array.isArray(body.tools) ? body.tools : []);
        }
      } catch {
        if (!cancelled) {
          setMcpOk(false);
          setMcpTools([]);
        }
      }
      if (cancelled) return;
      if (ok) setMcpSlow(false);
      // Check often while the backend is down, rarely once it's up.
      timer = window.setTimeout(ping, ok ? 20_000 : 5_000);
    };
    void ping();
    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return { mcpOk, mcpSlow, mcpVersion, mcpTools };
}
