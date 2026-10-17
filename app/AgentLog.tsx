"use client";

import { useEffect, useMemo, useRef } from "react";
import { useCopilotMessagesContext } from "@copilotkit/react-core";

type LogEntry = {
  id: string;
  t: number;
  kind: "user" | "route" | "tool" | "result" | "answer" | "error";
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

function toolName(call: ToolCall): string {
  return call.function?.name || call.name || "tool";
}

function summarizeArgs(raw: string | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const bits: string[] = [];
    if (typeof parsed.repo === "string") bits.push(`repo=${parsed.repo}`);
    if (typeof parsed.source === "string") bits.push(`source=${parsed.source}`);
    if (typeof parsed.path === "string") bits.push(`path=${parsed.path}`);
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
    case "brief_repo_ask":
      return "MCP → GitHub (README + issues + code + releases)";
    case "brief_repo_overview":
      return "MCP → GitHub README API";
    case "brief_repo_file":
      return "MCP → GitHub Contents API";
    case "brief_workspace":
      return "MCP → workspace-brief CLI → GitHub issues/PRs";
    case "brief_corpus":
      return "MCP → corpus-brief (local docs)";
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
  { id: "mcp", label: "MCP :Render" },
  { id: "backend", label: "GitHub / brief CLI" },
] as const;

function activeStages(entries: LogEntry[]): Set<string> {
  const active = new Set<string>();
  if (!entries.length) return active;
  const last = entries[entries.length - 1];
  active.add("ui");
  if (last.kind === "user") {
    active.add("api");
    active.add("agent");
  } else if (last.kind === "tool" || last.kind === "route") {
    active.add("api");
    active.add("agent");
    active.add("mcp");
    active.add("backend");
  } else if (last.kind === "result") {
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

export function AgentLog() {
  const { messages } = useCopilotMessagesContext();
  const bottomRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => {
    const out: LogEntry[] = [];
    let n = 0;
    const push = (partial: Omit<LogEntry, "id" | "t">) => {
      out.push({ id: `e-${n++}`, t: Date.now(), ...partial });
    };

    for (const raw of messages as unknown[]) {
      const msg = asRecord(raw);
      if (!msg) continue;
      const role = String(msg.role || "");
      const content =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .map((part) => {
                  const p = asRecord(part);
                  return typeof p?.text === "string" ? p.text : "";
                })
                .join("")
            : "";

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
            push({
              kind: "tool",
              title: `Tool ${name}`,
              detail: `${routeForTool(name)}${summarizeArgs(call.function?.arguments) ? ` · ${summarizeArgs(call.function?.arguments)}` : ""}`,
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
        const name = typeof msg.name === "string" ? msg.name : "tool";
        const err =
          typeof msg.content === "string" &&
          (msg.content.includes("failed:") || msg.content.includes('"isError":true'));
        push({
          kind: err ? "error" : "result",
          title: err ? `Tool error ← ${name}` : `Result ← ${name}`,
          detail: truncateOneLine(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content), 160),
        });
      }
    }
    return out;
  }, [messages]);

  const stages = activeStages(entries);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length]);

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        borderLeft: "1px solid var(--line)",
        background: "#0b1220",
        color: "#e2e8f0",
      }}
    >
      <div style={{ padding: "16px 16px 10px", borderBottom: "1px solid #1e293b" }}>
        <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.08em", color: "#94a3b8" }}>
          AGENT LOG
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#cbd5e1", lineHeight: 1.4 }}>
          Live path: UI → runtime → MCP → backends
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "12px 16px",
          borderBottom: "1px solid #1e293b",
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

      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px 24px" }}>
        {entries.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
            Send a chat message to see the agent route and tool calls here in realtime.
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
  }
}

function truncateOneLine(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}
