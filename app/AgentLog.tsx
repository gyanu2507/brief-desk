"use client";

import { useEffect, useRef, useState } from "react";
import { useChatTranscript } from "./transcript-bridge";

type LogEntry = {
  id: string;
  t: number;
  kind: "user" | "route" | "tool" | "result" | "answer" | "error" | "status";
  title: string;
  detail?: string;
};

type ToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  name?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function messageContent(msg: Record<string, unknown>): string {
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        const p = asRecord(part);
        if (!p) return "";
        if (typeof p.text === "string") return p.text;
        if (typeof p.content === "string") return p.content;
        return "";
      })
      .join("");
  }
  return "";
}

function toolName(call: ToolCall): string {
  return call.function?.name || call.name || "tool";
}

function summarizeArgs(raw: string | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const bits: string[] = [];
    if (typeof parsed.repo === "string") bits.push(`repo=${parsed.repo}`);
    if (typeof parsed.repo_b === "string") bits.push(`repo_b=${parsed.repo_b}`);
    if (typeof parsed.url === "string") bits.push(`url=${parsed.url}`);
    if (typeof parsed.mode === "string") bits.push(`mode=${parsed.mode}`);
    if (typeof parsed.source === "string") bits.push(`source=${parsed.source}`);
    if (typeof parsed.path === "string") bits.push(`path=${parsed.path}`);
    if (typeof parsed.query === "string") {
      const q = parsed.query.length > 72 ? `${parsed.query.slice(0, 72)}…` : parsed.query;
      bits.push(`query="${q}"`);
    }
    if (typeof parsed.question === "string") {
      const q = parsed.question.length > 72 ? `${parsed.question.slice(0, 72)}…` : parsed.question;
      bits.push(`q="${q}"`);
    }
    return bits.join(" · ") || raw.slice(0, 100);
  } catch {
    return raw.slice(0, 100);
  }
}

function routeForTool(name: string): string {
  switch (name) {
    case "brief_auto":
      return "MCP → autonomous plan+gather (one shot)";
    case "brief_plan":
      return "MCP → autonomous planner (invent source/mode/steps)";
    case "brief_orchestrate":
      return "MCP → orchestrator (plan → gather → guidance)";
    case "brief_eval":
      return "MCP → free eval rubric (groundedness / citations)";
    case "brief_fetch_url":
      return "MCP → public URL fetch";
    case "brief_web_search":
      return "MCP → DuckDuckGo Instant Answer";
    case "brief_repo_ask":
      return "MCP → GitHub (README + issues + code + releases)";
    case "brief_repo_overview":
      return "MCP → GitHub README API";
    case "brief_repo_file":
      return "MCP → GitHub Contents API";
    case "brief_corpus":
      return "MCP → bundled mcp/corpus";
    case "stack_info":
      return "MCP → stack_info";
    default:
      return `MCP → ${name}`;
  }
}

const PIPELINE = [
  { id: "ui", label: "CopilotKit UI" },
  { id: "api", label: "/api/copilotkit" },
  { id: "agent", label: "BuiltInAgent (Groq)" },
  { id: "mcp", label: "Python MCP" },
  { id: "backend", label: "GitHub / web / corpus" },
] as const;

function activeStages(entries: LogEntry[], inProgress: boolean): Set<string> {
  const active = new Set<string>();
  if (!entries.length && !inProgress) return active;
  active.add("ui");
  if (inProgress) {
    active.add("api");
    active.add("agent");
  }
  const last = entries[entries.length - 1];
  if (!last) return active;
  if (last.kind === "user" || last.kind === "status") {
    active.add("api");
    active.add("agent");
  } else if (last.kind === "tool" || last.kind === "route" || last.kind === "result") {
    active.add("api");
    active.add("agent");
    active.add("mcp");
    active.add("backend");
  } else if (last.kind === "answer") {
    active.add("api");
    active.add("agent");
  } else if (last.kind === "error") {
    active.add("api");
    active.add("agent");
  }
  return active;
}

function unwrapToolBody(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    // MCP CallToolResult shape: { content: [{ type: "text", text: "..." }], isError?: boolean }
    const obj = asRecord(parsed);
    if (obj && Array.isArray(obj.content)) {
      const texts = obj.content
        .map((part) => {
          const p = asRecord(part);
          return typeof p?.text === "string" ? p.text : "";
        })
        .filter(Boolean);
      if (texts.length) return texts.join("\n");
    }
    if (typeof parsed === "string") return parsed;
  } catch {
    // plain text tool result
  }
  return trimmed;
}

function isToolFailure(msg: Record<string, unknown>, body: string): boolean {
  if (msg.isError === true || msg.error === true) return true;
  if (typeof msg.error === "string" && msg.error.trim()) return true;
  // Only treat explicit MCP/tool failure markers, not README text that mentions "failed".
  if (/"isError"\s*:\s*true/.test(body)) return true;
  if (/\bbrief_[a-z_]+\s+failed:/i.test(body)) return true;
  if (/^(Error|FAILED)\b/.test(body.trim())) return true;
  return false;
}

function summarizeToolResult(body: string): string {
  const unwrapped = unwrapToolBody(body);
  try {
    const parsed = JSON.parse(unwrapped) as Record<string, unknown>;
    const bits: string[] = [];
    if (typeof parsed.repo === "string") bits.push(parsed.repo);
    if (typeof parsed.intent === "string") bits.push(`intent=${parsed.intent}`);
    if (typeof parsed.description === "string" && parsed.description) {
      bits.push(parsed.description.slice(0, 80));
    }
    if (bits.length) return bits.join(" · ");
  } catch {
    // not JSON
  }
  return truncateOneLine(unwrapped, 160);
}

function buildEntries(messages: unknown[], runtimeErrors: LogEntry[]): LogEntry[] {
  const out: LogEntry[] = [];
  let n = 0;
  const push = (partial: Omit<LogEntry, "id" | "t">) => {
    out.push({ id: `e-${n++}`, t: Date.now(), ...partial });
  };
  const toolNamesByCallId = new Map<string, string>();

  for (const raw of messages) {
    const msg = asRecord(raw);
    if (!msg) continue;
    const role = String(msg.role || "assistant");
    const content = messageContent(msg);

    // Skip CopilotKit placeholder / system noise in the log.
    if (role === "system" || role === "developer" || role === "activity" || role === "reasoning") {
      continue;
    }
    if (typeof msg.name === "string" && msg.name === "coagent-state-render") {
      continue;
    }

    if (role === "user") {
      push({
        kind: "user",
        title: "User → chat",
        detail: content.slice(0, 140) || "(empty)",
      });
      push({
        kind: "route",
        title: "Route",
        detail: "UI → POST /api/copilotkit (single-route agent/run) → BuiltInAgent",
      });
      continue;
    }

    if (role === "assistant") {
      const calls = (msg.toolCalls || msg.tool_calls || []) as ToolCall[];
      if (Array.isArray(calls) && calls.length) {
        for (const call of calls) {
          const name = toolName(call);
          if (call.id) toolNamesByCallId.set(call.id, name);
          const args = summarizeArgs(call.function?.arguments);
          push({
            kind: "tool",
            title: `Tool ${name}`,
            detail: `${routeForTool(name)}${args ? ` · ${args}` : ""}`,
          });
        }
      }
      if (content.trim()) {
        push({
          kind: "answer",
          title: "Assistant reply",
          detail: content.slice(0, 160) + (content.length > 160 ? "…" : ""),
        });
      }
      continue;
    }

    if (role === "tool") {
      const callId = typeof msg.toolCallId === "string" ? msg.toolCallId : "";
      const name =
        (typeof msg.name === "string" && msg.name) ||
        (callId && toolNamesByCallId.get(callId)) ||
        (callId ? `toolCall ${callId.slice(0, 8)}` : "tool");
      const body = content || (msg.content != null ? String(msg.content) : "");
      const err = isToolFailure(msg, body);
      push({
        kind: err ? "error" : "result",
        title: err ? `Tool error ← ${name}` : `Result ← ${name}`,
        detail: err
          ? truncateOneLine(unwrapToolBody(body) || body, 160)
          : summarizeToolResult(body),
      });
    }
  }
  return [...out, ...runtimeErrors];
}

export function AgentLog() {
  const { messages, inProgress, updatedAt } = useChatTranscript();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [runtimeErrors, setRuntimeErrors] = useState<LogEntry[]>([]);

  useEffect(() => {
    const onErr = (ev: Event) => {
      const detail = (ev as CustomEvent<string>).detail;
      const message = typeof detail === "string" ? detail : "Unknown runtime error";
      setRuntimeErrors((prev) => [
        ...prev.slice(-19),
        {
          id: `rt-${Date.now()}`,
          t: Date.now(),
          kind: "error",
          title: "Runtime error",
          detail: truncateOneLine(message, 200),
        },
      ]);
    };
    const onAnswer = (ev: Event) => {
      const detail = (ev as CustomEvent<{ answer?: string; steps?: string[]; ms?: number }>).detail;
      const steps = Array.isArray(detail?.steps) ? detail.steps.join(" → ") : "brief-run";
      setRuntimeErrors((prev) => [
        ...prev.slice(-19),
        {
          id: `ans-${Date.now()}`,
          t: Date.now(),
          kind: "answer",
          title: `Brief result ← ${steps}`,
          detail: truncateOneLine(detail?.answer || "", 200),
        },
      ]);
    };
    window.addEventListener("brief-desk-error", onErr);
    window.addEventListener("brief-desk-answer", onAnswer);
    return () => {
      window.removeEventListener("brief-desk-error", onErr);
      window.removeEventListener("brief-desk-answer", onAnswer);
    };
  }, []);

  const built = buildEntries(messages, runtimeErrors);
  const entries =
    inProgress && built.every((e) => e.kind !== "status")
      ? [
          ...built,
          {
            id: "run-active",
            t: Date.now(),
            kind: "status" as const,
            title: "Agent run in progress",
            detail: "BuiltInAgent → MCP tools → stream reply",
          },
        ]
      : built;
  const stages = activeStages(entries, inProgress);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length, updatedAt, inProgress]);

  return (
    <aside
      className="agent-log"
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "16px 16px 10px", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
        <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.08em", color: "#94a3b8" }}>
          AGENT LOG
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#cbd5e1", lineHeight: 1.4 }}>
          Live path: UI → runtime → MCP → backends
          {inProgress ? " · running…" : ""}
          {messages.length > 0 ? ` · ${messages.length} msg` : ""}
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "12px 16px",
          borderBottom: "1px solid #1e293b",
          flexShrink: 0,
        }}
      >
        {PIPELINE.map((step, i) => {
          const on = stages.has(step.id);
          return (
            <span
              key={step.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 999,
                border: `1px solid ${on ? "#38bdf8" : "#334155"}`,
                background: on ? "rgba(56,189,248,0.12)" : "transparent",
                color: on ? "#7dd3fc" : "#64748b",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: on ? "#38bdf8" : "#475569",
                }}
              />
              {i + 1}. {step.label}
            </span>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px 24px", minHeight: 0 }}>
        {entries.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
            Send a chat message. This panel mirrors the chat transcript (tools + replies) as they
            stream.
          </p>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
            {entries.map((e) => (
              <li
                key={e.id}
                style={{
                  borderLeft: `3px solid ${colorFor(e.kind)}`,
                  padding: "6px 0 6px 10px",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: colorFor(e.kind) }}>{e.title}</div>
                {e.detail ? (
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 12,
                      color: "#94a3b8",
                      lineHeight: 1.45,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {e.detail}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>
    </aside>
  );
}

function colorFor(kind: LogEntry["kind"]): string {
  switch (kind) {
    case "user":
      return "#a5b4fc";
    case "route":
      return "#38bdf8";
    case "tool":
      return "#fbbf24";
    case "result":
      return "#34d399";
    case "answer":
      return "#e2e8f0";
    case "error":
      return "#f87171";
    case "status":
      return "#c084fc";
  }
}

function truncateOneLine(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}
