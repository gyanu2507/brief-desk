"use client";

import { useDefaultTool } from "@copilotkit/react-core";

const TOOL_HINTS: Record<string, string> = {
  brief_auto: "Plan + gather (one shot)",
  brief_plan: "Invent source / mode / steps",
  brief_orchestrate: "Plan → gather → guidance",
  brief_eval: "Heuristic groundedness check",
  brief_fetch_url: "Public URL fetch",
  brief_web_search: "DuckDuckGo Instant Answer",
  brief_repo_ask: "GitHub evidence pack",
  brief_repo_overview: "GitHub README + meta",
  brief_repo_file: "GitHub file contents",
  brief_corpus: "Bundled mcp/corpus",
  stack_info: "Stack descriptor",
};

function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const bits: string[] = [];
  for (const key of ["repo", "repo_b", "url", "mode", "path", "query", "goal", "question"]) {
    const v = args[key];
    if (typeof v !== "string" || !v.trim()) continue;
    const short = v.length > 56 ? `${v.slice(0, 56)}…` : v;
    bits.push(`${key}=${short}`);
  }
  return bits.join(" · ");
}

function summarizeResult(result: unknown): string {
  if (result == null) return "";
  const raw = typeof result === "string" ? result : JSON.stringify(result);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(parsed.hits)) return `${parsed.hits.length} hits`;
    if (typeof parsed.repo === "string") return parsed.repo;
    if (typeof parsed.pass === "boolean") {
      return parsed.pass ? "eval pass" : "eval revise";
    }
    if (parsed.invented && typeof parsed.invented === "object") {
      const inv = parsed.invented as Record<string, unknown>;
      const parts = [inv.source_kind, inv.mode, inv.repo, inv.url].filter(
        (x) => typeof x === "string" && x,
      );
      if (parts.length) return parts.join(" · ");
    }
  } catch {
    // plain text
  }
  const one = raw.replace(/\s+/g, " ").trim();
  return one.length > 120 ? `${one.slice(0, 120)}…` : one;
}

function ToolCardView({
  name,
  status,
  args,
  result,
}: {
  name: string;
  status: string;
  args?: Record<string, unknown>;
  result?: unknown;
}) {
  const hint = TOOL_HINTS[name] || "MCP tool";
  const argLine = summarizeArgs(args);
  const resultLine = status === "complete" ? summarizeResult(result) : "";
  const tone =
    status === "complete" ? "done" : status === "executing" || status === "inProgress" ? "run" : "idle";

  return (
    <div className={`tool-card tool-card-${tone}`} data-tool={name}>
      <div className="tool-card-head">
        <span className="tool-card-name">{name}</span>
        <span className="tool-card-status">{status}</span>
      </div>
      <p className="tool-card-hint">{hint}</p>
      {argLine ? <p className="tool-card-meta">{argLine}</p> : null}
      {resultLine ? <p className="tool-card-meta tool-card-result">{resultLine}</p> : null}
    </div>
  );
}

/** In-chat cards for MCP tool calls (free-form CopilotKit path). */
export function ToolCards() {
  useDefaultTool({
    render: ({ name, status, args, result }) => (
      <ToolCardView
        name={typeof name === "string" ? name : "tool"}
        status={String(status)}
        args={args as Record<string, unknown> | undefined}
        result={result}
      />
    ),
  });
  return null;
}
