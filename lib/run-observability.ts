import { randomBytes } from "node:crypto";
import { CANCELLED_MESSAGE, TIMEOUT_MESSAGE } from "./abort";

export type ErrorCategory =
  | "cancelled"
  | "timeout"
  | "validation"
  | "mcp"
  | "model"
  | "rate_limit"
  | "network"
  | "unknown";

export type ToolTiming = {
  tool: string;
  ms: number;
  ok: boolean;
  error?: string;
};

export type ModelUsage = {
  model: string;
  calls: number;
  promptChars: number;
  completionChars: number;
  ms: number;
};

export type RunObservability = {
  runId: string;
  toolTimings: ToolTiming[];
  modelUsage: ModelUsage | null;
  errorCategory?: ErrorCategory;
};

export function newRunId(): string {
  const stamp = Date.now().toString(36);
  const rand = randomBytes(4).toString("hex");
  return `br_${stamp}_${rand}`;
}

export function categorizeError(message: string | undefined | null): ErrorCategory {
  const m = (message || "").toLowerCase();
  if (!m) return "unknown";
  if (m === CANCELLED_MESSAGE.toLowerCase() || /cancel/.test(m)) return "cancelled";
  if (m === TIMEOUT_MESSAGE.toLowerCase() || /timed out|timeout/.test(m)) return "timeout";
  if (/required|too long|invalid|must be/.test(m)) return "validation";
  if (/rate limit|try again|429/.test(m)) return "rate_limit";
  if (/mcp|tool |json-rpc|orchestrate|brief_/.test(m)) return "mcp";
  if (/draft|model|openai|groq|empty content/.test(m)) return "model";
  if (/fetch failed|econn|enotfound|network|socket/.test(m)) return "network";
  return "unknown";
}

export function actionableErrorMessage(
  category: ErrorCategory,
  detail: string,
  runId?: string,
): string {
  const suffix = runId ? ` (run ${runId})` : "";
  switch (category) {
    case "cancelled":
      return `Run cancelled.${suffix}`;
    case "timeout":
      return `A tool or model call timed out. Retry once, or narrow the source.${suffix}`;
    case "rate_limit":
      return `Model rate limit hit. Wait a few seconds, then Retry.${suffix}`;
    case "validation":
      return `Input failed validation: ${detail}${suffix}`;
    case "mcp":
      return `MCP tool failed: ${detail} Check MCP health, then Retry.${suffix}`;
    case "model":
      return `Draft model failed: ${detail}${suffix}`;
    case "network":
      return `Network error talking to MCP or the model: ${detail}${suffix}`;
    default:
      return `${detail || "brief-run failed"}${suffix}`;
  }
}

export function logRunEvent(
  event: string,
  fields: Record<string, unknown>,
): void {
  // Structured one-line JSON for hosts that scrape stdout.
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      service: "brief-desk",
      event,
      ...fields,
    }),
  );
}
