"use client";

import { CopilotChat } from "@copilotkit/react-ui";

export default function Page() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "minmax(240px, 320px) 1fr",
        gap: 0,
      }}
    >
      <aside
        style={{
          padding: "28px 22px",
          borderRight: "1px solid var(--line)",
          background: "var(--panel)",
        }}
      >
        <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>
          BRIEF-DESK
        </p>
        <h1 style={{ margin: "8px 0 12px", fontSize: 28, lineHeight: 1.15 }}>
          Agent desk for live workspaces
        </h1>
        <p style={{ margin: "0 0 18px", color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
          CopilotKit UI streams over AG-UI. The agent calls MCP tools backed by
          workspace-brief (any GitHub repo) and corpus-brief (local docs).
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink)", fontSize: 14, lineHeight: 1.6 }}>
          <li>CopilotKit chat + runtime</li>
          <li>AG-UI agent protocol</li>
          <li>MCP tools on :3108</li>
        </ul>
        <p style={{ marginTop: 22, fontSize: 13, color: "var(--muted)" }}>
          Try: &quot;what are the open checkout risks?&quot; or &quot;how do webhooks stay
          idempotent?&quot;
        </p>
      </aside>
      <section style={{ minHeight: "100vh", background: "#eef2ff" }}>
        <CopilotChat
          labels={{
            title: "brief-desk",
            initial: "Ask about a GitHub workspace or the sample doc corpus. I will use MCP tools.",
          }}
          className="h-full"
        />
      </section>
    </main>
  );
}
