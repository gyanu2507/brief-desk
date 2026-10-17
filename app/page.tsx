"use client";

import { useEffect, useState } from "react";
import { useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { AgentLog } from "./AgentLog";
import { LoggingMessages, TranscriptProvider } from "./transcript-bridge";

const REPO_KEY = "brief-desk-repo";
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function normalizeRepo(value: string): string | null {
  const trimmed = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
  return REPO_RE.test(trimmed) ? trimmed : null;
}

export default function Page() {
  const [repoInput, setRepoInput] = useState("");
  const activeRepo = normalizeRepo(repoInput);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REPO_KEY);
      if (saved) setRepoInput(saved);
    } catch {
      // ignore private-mode storage failures
    }
  }, []);

  useEffect(() => {
    if (!activeRepo) return;
    try {
      localStorage.setItem(REPO_KEY, activeRepo);
    } catch {
      // ignore
    }
  }, [activeRepo]);

  useCopilotReadable({
    description:
      "Active GitHub repository. Prefer brief_repo_overview for features/overview, brief_workspace for issues/PRs, brief_repo_ask for code/how-it-works. Pass this repo on every tool call.",
    value: activeRepo
      ? { repo: activeRepo, source: "github", mode: "live" }
      : {
          repo: null,
          source: "fixture",
          mode: "sample",
          note: "No owner/name selected. Ask for a GitHub repo, or use the offline sample if the user wants the demo fixture.",
        },
  });

  return (
    <TranscriptProvider>
    <main
      className="desk-shell"
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr) minmax(260px, 340px)",
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
          Pick any public GitHub repo. The right panel shows the live agent route
          and tool calls as they run.
        </p>

        <label
          style={{
            display: "block",
            fontSize: 12,
            letterSpacing: "0.04em",
            color: "var(--muted)",
            marginBottom: 6,
          }}
        >
          GITHUB REPO
        </label>
        <input
          type="text"
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          placeholder="owner/name"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            fontSize: 14,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            color: "var(--ink)",
            background: "#fff",
          }}
        />
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
          {activeRepo
            ? `Live mode: ${activeRepo}`
            : "Enter owner/name (or a github.com URL) for realtime answers."}
        </p>

        <ul
          style={{
            margin: "22px 0 0",
            paddingLeft: 18,
            color: "var(--ink)",
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <li>CopilotKit chat + runtime</li>
          <li>AG-UI agent protocol</li>
          <li>MCP → GitHub / brief CLIs</li>
        </ul>
        <p style={{ marginTop: 22, fontSize: 13, color: "var(--muted)" }}>
          Try: &quot;what are the main features?&quot;, &quot;how does auth work?&quot;,
          or &quot;what are the open issues?&quot;
        </p>
      </aside>
      <section style={{ minHeight: "100vh", background: "#eef2ff", minWidth: 0 }}>
        <CopilotChat
          labels={{
            title: "brief-desk",
            initial: activeRepo
              ? `Ask about ${activeRepo}. Watch the agent log for the live route.`
              : "Set a GitHub owner/name on the left for live answers, or ask about the offline sample workspace.",
          }}
          className="h-full"
          Messages={LoggingMessages}
        />
      </section>
      <AgentLog />
    </main>
    </TranscriptProvider>
  );
}
