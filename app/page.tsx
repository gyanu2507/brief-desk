"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useCopilotChatInternal, useCopilotReadable } from "@copilotkit/react-core";
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
  repo?: string;
  repoB?: string;
  url?: string;
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

const DEFAULT_Q: Record<BriefMode, string> = {
  overview: "What are the main features and who is this for?",
  risks: "What are the biggest risks and open issues right now?",
  architecture: "How is the project structured and what are the main modules?",
  activity: "What has landed recently in issues, PRs, and releases?",
  code: "Where should I start reading the code for the core flow?",
  docs: "Summarize the docs a new engineer needs first.",
  general: "Give a concise engineering brief with citations.",
};

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
    "Compare these for a production SaaS product.",
    "Which is simpler to adopt and why?",
    "Tradeoffs: ecosystem, complexity, maturity.",
  ],
  corpus: [
    "What is the checkout promo about?",
    "Summarize the sample docs.",
    "What open questions remain in the corpus?",
  ],
};

const DEMOS = [
  {
    label: "Demo · React risks",
    source: "github" as const,
    mode: "risks" as const,
    repo: "facebook/react",
    question: "What are the biggest risks and open issues right now?",
  },
  {
    label: "Demo · Next vs Remix",
    source: "compare" as const,
    mode: "general" as const,
    repo: "vercel/next.js",
    repoB: "remix-run/remix",
    question: "Compare these for a production SaaS frontend. Cite README facts.",
  },
  {
    label: "Demo · MCP docs",
    source: "url" as const,
    mode: "docs" as const,
    url: "https://modelcontextprotocol.io/introduction",
    question: "Summarize this for an engineer building an MCP tool server.",
  },
];

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

function buildPrompt(args: {
  source: SourceKind;
  mode: BriefMode;
  repo: string | null;
  repoB: string | null;
  url: string | null;
  question: string;
}): string {
  const mode = args.source === "compare" ? "compare" : args.mode;
  const lines = [
    "Run a brief-desk briefing.",
    `source=${args.source}`,
    `mode=${mode}`,
    args.repo ? `repo=${args.repo}` : null,
    args.repoB ? `repo_b=${args.repoB}` : null,
    args.url ? `url=${args.url}` : null,
    "Call brief_orchestrate with these fields, draft from evidence, then brief_eval. Revise if pass=false. Cite sources.",
    "",
    `Question: ${args.question}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export default function Page() {
  const { sendMessage, isLoading } = useCopilotChatInternal();
  const [source, setSource] = useState<SourceKind>("github");
  const [mode, setMode] = useState<BriefMode>("overview");
  const [repoInput, setRepoInput] = useState("");
  const [repoBInput, setRepoBInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [saved, setSaved] = useState<SavedBrief[]>([]);
  const [mcpOk, setMcpOk] = useState<boolean | null>(null);
  const [mcpVersion, setMcpVersion] = useState<string>("");
  const [busyNote, setBusyNote] = useState<string | null>(null);

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
        repo,
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
        repo,
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

  const runBrief = useCallback(
    async (
      question: string,
      override?: Partial<{
        source: SourceKind;
        mode: BriefMode;
        repo: string | null;
        repoB: string | null;
        url: string | null;
      }>,
    ) => {
      if (isLoading) return;
      const s = override?.source ?? source;
      const m = override?.mode ?? mode;
      const r = override?.repo !== undefined ? override.repo : repo;
      const rB = override?.repoB !== undefined ? override.repoB : repoB;
      const u = override?.url !== undefined ? override.url : url;
      const sessionReady =
        (s === "github" && Boolean(r)) ||
        (s === "url" && Boolean(u)) ||
        (s === "compare" && Boolean(r) && Boolean(rB)) ||
        s === "corpus";
      if (!sessionReady) return;
      const content = buildPrompt({
        source: s,
        mode: m,
        repo: r,
        repoB: rB,
        url: u,
        question,
      });
      setBusyNote("Running orchestrate → eval…");
      try {
        await sendMessage({
          id: crypto.randomUUID(),
          role: "user",
          content,
        });
      } finally {
        setBusyNote(null);
      }
    },
    [isLoading, sendMessage, source, mode, repo, repoB, url],
  );

  const pinSession = () => {
    if (!ready) return;
    const label =
      source === "github"
        ? repo || "github"
        : source === "url"
          ? url || "url"
          : source === "compare"
            ? `${repo} vs ${repoB}`
            : "corpus sample";
    setSaved((prev) =>
      [
        {
          id: `${Date.now()}`,
          at: Date.now(),
          label,
          source,
          mode: source === "compare" ? "general" : mode,
          repo: repo || undefined,
          repoB: repoB || undefined,
          url: url || undefined,
        },
        ...prev,
      ].slice(0, 8),
    );
  };

  const loadDemo = (demo: (typeof DEMOS)[number]) => {
    setSource(demo.source);
    setMode(demo.mode);
    setRepoInput(demo.repo || "");
    setRepoBInput(demo.repoB || "");
    setUrlInput(demo.url || "");
  };

  const chatHint = !ready
    ? "Fill the left panel, click Start brief, or pick a demo. Loop: orchestrate → eval."
    : source === "compare"
      ? `Ready to compare ${repo} vs ${repoB}. Use Start brief or ask in chat.`
      : source === "url"
        ? `Docs URL ready. Start brief or ask what to extract.`
        : source === "corpus"
          ? "Corpus sample ready. Start brief or ask about the bundled docs."
          : `Repo ${repo} · ${mode}. Start brief or type a follow-up.`;

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
            Configure a source, then Start brief. The agent orchestrates tools and runs a free eval
            pass before answering.
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
            MCP {mcpOk === null ? "checking…" : mcpOk ? `online${mcpVersion ? ` · v${mcpVersion}` : ""}` : "offline · redeploy Render"}
          </div>

          <p style={labelStyle}>QUICK DEMOS</p>
          <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
            {DEMOS.map((d) => (
              <button
                key={d.label}
                type="button"
                disabled={isLoading}
                onClick={() => {
                  loadDemo(d);
                  void runBrief(d.question, {
                    source: d.source,
                    mode: d.mode,
                    repo: d.repo || null,
                    repoB: d.repoB || null,
                    url: d.url || null,
                  });
                }}
                style={{
                  ...chipStyle,
                  textAlign: "left",
                  background: "#f8fafc",
                }}
              >
                {d.label}
              </button>
            ))}
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
            </>
          ) : null}

          {source === "corpus" ? (
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--muted)", lineHeight: 1.45 }}>
              Bundled local markdown on the MCP host. No GitHub token needed.
            </p>
          ) : null}

          <button
            type="button"
            onClick={() =>
              void runBrief(
                source === "compare"
                  ? SUGGEST.compare[0]
                  : source === "corpus"
                    ? SUGGEST.corpus[0]
                    : source === "url"
                      ? SUGGEST.url[0]
                      : DEFAULT_Q[mode],
              )
            }
            disabled={!ready || isLoading || mcpOk === false}
            style={{
              marginTop: 14,
              width: "100%",
              padding: "11px 12px",
              borderRadius: 8,
              border: "none",
              background: !ready || isLoading || mcpOk === false ? "#cbd5e1" : "var(--accent)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: !ready || isLoading || mcpOk === false ? "not-allowed" : "pointer",
            }}
          >
            {isLoading || busyNote ? "Running…" : "Start brief"}
          </button>

          <button
            type="button"
            onClick={pinSession}
            disabled={!ready}
            style={{
              marginTop: 8,
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "#fff",
              color: ready ? "var(--ink)" : "#94a3b8",
              fontSize: 13,
              cursor: ready ? "pointer" : "not-allowed",
            }}
          >
            Save session shortcut
          </button>

          <p style={{ ...labelStyle, marginTop: 18 }}>CLICK TO RUN</p>
          <div style={{ display: "grid", gap: 6 }}>
            {SUGGEST[source].map((s) => (
              <button
                key={s}
                type="button"
                disabled={!ready || isLoading}
                onClick={() => void runBrief(s)}
                style={{
                  ...chipStyle,
                  textAlign: "left",
                  color: !ready || isLoading ? "#94a3b8" : "var(--ink)",
                }}
              >
                {s}
              </button>
            ))}
          </div>

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
                        setRepoInput(s.repo || (s.source === "github" ? s.label : ""));
                        setRepoBInput(s.repoB || "");
                        setUrlInput(s.url || (s.source === "url" ? s.label : ""));
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

        <section style={{ minHeight: "100vh", background: "#eef2ff", minWidth: 0, display: "relative" }}>
          {busyNote || isLoading ? (
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 12,
                right: 12,
                zIndex: 5,
                padding: "8px 12px",
                borderRadius: 8,
                background: "#0f172a",
                color: "#e2e8f0",
                fontSize: 12,
              }}
            >
              {busyNote || "Agent running… watch the log for orchestrate → eval."}
            </div>
          ) : null}
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
