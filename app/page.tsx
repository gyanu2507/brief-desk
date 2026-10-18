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
      "Active briefing context. Prefer brief_orchestrate then brief_eval. Sources: GitHub repo (if set), public docs URLs, or brief_corpus. Compare needs repo_b. Pass repo on tool calls when set.",
    value: activeRepo
      ? { repo: activeRepo, source: "github", mode: "live", loop: "orchestrate→draft→eval" }
      : {
          repo: null,
          source: "open",
          mode: "multi-source",
          note: "No repo selected. User can give owner/name, a public docs URL, ask to compare two repos, or use the local corpus sample.",
          loop: "orchestrate→draft→eval",
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
          Orchestrated briefing desk
        </h1>
        <p style={{ margin: "0 0 18px", color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
          GitHub repos, public docs URLs, or local corpus. Orchestrator plans,
          gathers evidence, then a free eval rubric checks the draft.
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
            ? `Repo context: ${activeRepo} (still can pass a docs URL in chat)`
            : "Optional repo. Or ask with a public docs URL, compare two repos, or use the corpus sample."}
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
          <li>Orchestrate → draft → eval</li>
          <li>GitHub + public URLs + corpus</li>
          <li>AG-UI + MCP (free Groq)</li>
        </ul>
        <p style={{ marginTop: 22, fontSize: 13, color: "var(--muted)" }}>
          Try: &quot;compare owner/a vs owner/b&quot;, &quot;risks in this repo&quot;,
          or &quot;summarize https://… docs&quot;.
        </p>
      </aside>
      <section style={{ minHeight: "100vh", background: "#eef2ff", minWidth: 0 }}>
        <CopilotChat
          labels={{
            title: "brief-desk",
            initial: activeRepo
              ? `Ask about ${activeRepo}, pass a docs URL, or request a risk/architecture brief. The agent runs orchestrate → eval.`
              : "Give a GitHub owner/name, a public docs URL, two repos to compare, or ask the local corpus sample. Loop: orchestrate → eval.",
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
