"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { AgentLog } from "./AgentLog";
import { LoggingMessages, TranscriptProvider } from "./transcript-bridge";

const STORE_KEY = "brief-desk-v2";
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

type SourceKind = "github" | "url" | "compare" | "corpus";
type BriefMode = "overview" | "risks" | "architecture" | "activity" | "code" | "docs" | "general";

type SavedBrief = {
  id: string;
  at: number;
  label: string;
  source: SourceKind;
  mode: BriefMode;
};

function normalizeRepo(value: string): string | null {
  const trimmed = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
  return REPO_RE.test(trimmed) ? trimmed : null;
}

function normalizeUrl(value: string): string | null {
  const t = value.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

const MODES: { id: BriefMode; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "risks", label: "Risks" },
  { id: "architecture", label: "Architecture" },
  { id: "activity", label: "Activity" },
  { id: "code", label: "Code" },
  { id: "docs", label: "Docs" },
  { id: "general", label: "General" },
];

const SUGGEST: Record<SourceKind, string[]> = {
  github: [
    "What are the main features?",
    "What are the biggest risks right now?",
    "How is the project structured?",
  ],
  url: [
    "Summarize this document for an engineer.",
    "What should I implement first from these docs?",
    "List key concepts and APIs mentioned.",
  ],
  compare: [
    "Compare these repos for a production SaaS frontend.",
    "Which is simpler to adopt and why?",
    "Tradeoffs: ecosystem, complexity, maturity.",
  ],
  corpus: [
    "What is the checkout promo about?",
    "Summarize the sample docs.",
    "What open questions remain in the corpus?",
  ],
};

const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "var(--ink)",
  background: "#fff",
};

export default function Page() {
  const [source, setSource] = useState<SourceKind>("github");
  const [mode, setMode] = useState<BriefMode>("overview");
  const [repoInput, setRepoInput] = useState("");
  const [repoBInput, setRepoBInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [saved, setSaved] = useState<SavedBrief[]>([]);
  const [mcpOk, setMcpOk] = useState<boolean | null>(null);
  const [mcpVersion, setMcpVersion] = useState<string>("");

  const repo = normalizeRepo(repoInput);
  const repoB = normalizeRepo(repoBInput);
  const url = normalizeUrl(urlInput);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) {
        const legacy = localStorage.getItem("brief-desk-repo");
        if (legacy) setRepoInput(legacy);
        return;
      }
      const parsed = JSON.parse(raw) as {
        source?: SourceKind;
        mode?: BriefMode;
        repo?: string;
        repoB?: string;
        url?: string;
        saved?: SavedBrief[];
      };
      if (parsed.source) setSource(parsed.source);
      if (parsed.mode) setMode(parsed.mode);
      if (parsed.repo) setRepoInput(parsed.repo);
      if (parsed.repoB) setRepoBInput(parsed.repoB);
      if (parsed.url) setUrlInput(parsed.url);
      if (Array.isArray(parsed.saved)) setSaved(parsed.saved.slice(0, 8));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          source,
          mode,
          repo: repoInput,
          repoB: repoBInput,
          url: urlInput,
          saved,
        }),
      );
    } catch {
      // ignore
    }
  }, [source, mode, repoInput, repoBInput, urlInput, saved]);

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const res = await fetch("/api/mcp-health", { cache: "no-store" });
        const body = (await res.json()) as { ok?: boolean; version?: string };
        if (!cancelled) {
          setMcpOk(Boolean(body.ok));
          setMcpVersion(typeof body.version === "string" ? body.version : "");
        }
      } catch {
        if (!cancelled) setMcpOk(false);
      }
    };
    void ping();
    const id = window.setInterval(ping, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const contextValue = useMemo(() => {
    const base = {
      loop: "orchestrate→draft→eval",
      brief_mode: source === "compare" ? "compare" : mode,
      source_kind: source,
    };
    if (source === "github") {
      return {
        ...base,
        repo: repo,
        url: null,
        repo_b: null,
        note: repo
          ? `Use brief_orchestrate with repo=${repo} and mode=${mode}, then brief_eval.`
          : "Ask user for owner/name or switch source.",
      };
    }
    if (source === "url") {
      return {
        ...base,
        repo: repo,
        url,
        repo_b: null,
        note: url
          ? `Use brief_orchestrate with url=${url}` + (repo ? ` and repo=${repo}` : "") + `, mode=${mode}, then brief_eval.`
          : "Ask user for a public https URL.",
      };
    }
    if (source === "compare") {
      return {
        ...base,
        repo,
        repo_b: repoB,
        url: null,
        note:
          repo && repoB
            ? `Use brief_orchestrate mode=compare repo=${repo} repo_b=${repoB}, then brief_eval.`
            : "Need two owner/name values for compare.",
      };
    }
    return {
      ...base,
      repo: null,
      repo_b: null,
      url: null,
      note: "Use brief_corpus for the bundled local sample, then brief_eval.",
    };
  }, [source, mode, repo, repoB, url]);

  useCopilotReadable({
    description:
      "Active brief-desk session. Always prefer brief_orchestrate then brief_eval using these fields. Do not invent tool names.",
    value: contextValue,
  });

  const ready =
    (source === "github" && Boolean(repo)) ||
    (source === "url" && Boolean(url)) ||
    (source === "compare" && Boolean(repo) && Boolean(repoB)) ||
    source === "corpus";

  const pinSession = () => {
    const label =
      source === "github"
        ? repo || "github"
        : source === "url"
          ? url || "url"
          : source === "compare"
            ? `${repo || "?"} vs ${repoB || "?"}`
            : "corpus sample";
    setSaved((prev) => [
      {
        id: `${Date.now()}`,
        at: Date.now(),
        label,
        source,
        mode: source === "compare" ? "general" : mode,
      },
      ...prev,
    ].slice(0, 8));
  };

  const chatHint = !ready
    ? "Fill the left panel (repo, URL, two repos, or corpus), then ask in chat. Loop: orchestrate → eval."
    : source === "compare"
      ? `Compare ${repo} vs ${repoB}. Ask a tradeoff question in chat.`
      : source === "url"
        ? `Docs source ready. Ask what to extract from the URL${repo ? ` (optional repo ${repo})` : ""}.`
        : source === "corpus"
          ? "Corpus sample mode. Ask about the bundled local docs."
          : `Repo ${repo} · mode ${mode}. Ask in chat (features, risks, architecture, code…).`;

  return (
    <TranscriptProvider>
      <main
        className="desk-shell"
        style={{
          minHeight: "100vh",
          display: "grid",
          gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr) minmax(260px, 340px)",
          gap: 0,
        }}
      >
        <aside
          className="desk-controls"
          style={{
            padding: "22px 18px",
            borderRight: "1px solid var(--line)",
            background: "var(--panel)",
            overflow: "auto",
            maxHeight: "100vh",
          }}
        >
          <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.08em", color: "var(--muted)" }}>
            BRIEF-DESK
          </p>
          <h1 style={{ margin: "6px 0 8px", fontSize: 24, lineHeight: 1.15 }}>
            Multi-source briefing app
          </h1>
          <p style={{ margin: "0 0 14px", color: "var(--muted)", fontSize: 13, lineHeight: 1.45 }}>
            One product surface: pick a source, pick a brief type, chat. Agent runs
            orchestrate → draft → eval (Groq + MCP, free).
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 14,
              fontSize: 12,
              color: mcpOk === null ? "var(--muted)" : mcpOk ? "#15803d" : "#b91c1c",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: mcpOk === null ? "#94a3b8" : mcpOk ? "#22c55e" : "#ef4444",
              }}
            />
            MCP {mcpOk === null ? "checking…" : mcpOk ? `online${mcpVersion ? ` · v${mcpVersion}` : ""}` : "offline"}
          </div>

          <p style={labelStyle}>SOURCE</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
            {(
              [
                ["github", "GitHub"],
                ["url", "Docs URL"],
                ["compare", "Compare"],
                ["corpus", "Corpus"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSource(id)}
                style={{
                  ...chipStyle,
                  borderColor: source === id ? "var(--accent)" : "var(--line)",
                  background: source === id ? "rgba(37,99,235,0.08)" : "#fff",
                  color: source === id ? "var(--accent)" : "var(--ink)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {source !== "compare" && source !== "corpus" ? (
            <>
              <p style={labelStyle}>BRIEF TYPE</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    style={{
                      ...chipStyle,
                      padding: "5px 8px",
                      borderColor: mode === m.id ? "var(--accent)" : "var(--line)",
                      background: mode === m.id ? "rgba(37,99,235,0.08)" : "#fff",
                      color: mode === m.id ? "var(--accent)" : "var(--ink)",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {source === "github" || source === "url" || source === "compare" ? (
            <>
              <p style={labelStyle}>{source === "compare" ? "REPO A" : "GITHUB REPO"}</p>
              <input
                style={fieldStyle}
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="owner/name"
                spellCheck={false}
              />
            </>
          ) : null}

          {source === "compare" ? (
            <>
              <p style={{ ...labelStyle, marginTop: 12 }}>REPO B</p>
              <input
                style={fieldStyle}
                value={repoBInput}
                onChange={(e) => setRepoBInput(e.target.value)}
                placeholder="owner/name"
                spellCheck={false}
              />
            </>
          ) : null}

          {source === "url" ? (
            <>
              <p style={{ ...labelStyle, marginTop: 12 }}>PUBLIC DOCS URL</p>
              <input
                style={fieldStyle}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://…"
                spellCheck={false}
              />
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--muted)" }}>
                Optional repo above ties the docs brief to a codebase.
              </p>
            </>
          ) : null}

          {source === "corpus" ? (
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--muted)", lineHeight: 1.45 }}>
              Uses the bundled local markdown corpus on the MCP host (no GitHub token needed).
            </p>
          ) : null}

          <p
            style={{
              margin: "12px 0 0",
              fontSize: 12,
              color: ready ? "#15803d" : "#b45309",
              lineHeight: 1.4,
            }}
          >
            {ready ? "Session ready. Ask in chat." : "Complete the fields for this source."}
          </p>

          <button
            type="button"
            onClick={pinSession}
            disabled={!ready}
            style={{
              marginTop: 10,
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: ready ? "#0f172a" : "#e2e8f0",
              color: ready ? "#fff" : "#94a3b8",
              fontSize: 13,
              cursor: ready ? "pointer" : "not-allowed",
            }}
          >
            Save session shortcut
          </button>

          <p style={{ ...labelStyle, marginTop: 18 }}>TRY ASKING</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--muted)", lineHeight: 1.55 }}>
            {SUGGEST[source].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>

          {saved.length ? (
            <>
              <p style={{ ...labelStyle, marginTop: 18 }}>SAVED</p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                {saved.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSource(s.source);
                        setMode(s.mode);
                        if (s.source === "compare" && s.label.includes(" vs ")) {
                          const [a, b] = s.label.split(" vs ");
                          setRepoInput(a);
                          setRepoBInput(b);
                        } else if (s.source === "url") {
                          setUrlInput(s.label.startsWith("http") ? s.label : urlInput);
                        } else if (s.source === "github") {
                          setRepoInput(s.label);
                        }
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "7px 8px",
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                        background: "#f8fafc",
                        fontSize: 11,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        cursor: "pointer",
                        color: "var(--ink)",
                      }}
                    >
                      {s.source} · {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>

        <section style={{ minHeight: "100vh", background: "#eef2ff", minWidth: 0 }}>
          <CopilotChat
            labels={{
              title: "brief-desk",
              initial: chatHint,
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

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 11,
  letterSpacing: "0.06em",
  color: "var(--muted)",
  marginBottom: 6,
};

const chipStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "#fff",
  fontSize: 12,
  cursor: "pointer",
};
