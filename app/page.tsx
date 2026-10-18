"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useCopilotChatInternal, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { AgentLog } from "./AgentLog";
import { LoggingMessages, TranscriptProvider } from "./transcript-bridge";
import { DEFAULT_AUTO_GOAL, FALLBACK_UI } from "../lib/fallback-ui";
import { renderTemplate } from "../lib/template";
import type { BriefMode, PromptUi, SourceKind } from "../lib/types";

const STORE_KEY = "brief-desk-v3";
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_WATCHDOG_MS = 90_000;

type SavedBrief = {
  id: string;
  at: number;
  label: string;
  source: SourceKind;
  mode: BriefMode;
  repo?: string;
  repoB?: string;
  url?: string;
  goal?: string;
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

function sessionNote(
  ui: PromptUi,
  args: {
    source: SourceKind;
    mode: BriefMode;
    repo: string | null;
    repoB: string | null;
    url: string | null;
  },
): string {
  const notes = ui.sessionNotes;
  if (args.source === "auto") return notes.auto;
  if (args.source === "github") {
    return args.repo
      ? renderTemplate(notes.github_ready, { repo: args.repo, mode: args.mode })
      : notes.github_missing;
  }
  if (args.source === "url") {
    if (!args.url) return notes.url_missing;
    return renderTemplate(notes.url_ready, {
      url: args.url,
      mode: args.mode,
      repo_suffix: args.repo ? ` and repo=${args.repo}` : "",
    });
  }
  if (args.source === "compare") {
    return args.repo && args.repoB
      ? renderTemplate(notes.compare_ready, {
          repo: args.repo,
          repo_b: args.repoB,
        })
      : notes.compare_missing;
  }
  return notes.corpus;
}

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
  const { sendMessage, isLoading } = useCopilotChatInternal();
  const [source, setSource] = useState<SourceKind>("auto");
  const [mode, setMode] = useState<BriefMode>("overview");
  const [repoInput, setRepoInput] = useState("");
  const [repoBInput, setRepoBInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [goalInput, setGoalInput] = useState(DEFAULT_AUTO_GOAL);
  const [saved, setSaved] = useState<SavedBrief[]>([]);
  const [mcpOk, setMcpOk] = useState<boolean | null>(null);
  const [mcpVersion, setMcpVersion] = useState<string>("");
  const [mcpTools, setMcpTools] = useState<string[]>([]);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [promptUi, setPromptUi] = useState<PromptUi>(FALLBACK_UI);
  const [promptRoutes, setPromptRoutes] = useState<string[]>([
    "auto",
    "compare",
    "corpus",
    "followup",
    "github",
    "url",
  ]);

  const repo = normalizeRepo(repoInput);
  const repoB = normalizeRepo(repoBInput);
  const url = normalizeUrl(urlInput);
  const goal = goalInput.trim();

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
        goal?: string;
        saved?: SavedBrief[];
      };
      if (parsed.source) setSource(parsed.source);
      if (parsed.mode) setMode(parsed.mode);
      if (parsed.repo) setRepoInput(parsed.repo);
      if (parsed.repoB) setRepoBInput(parsed.repoB);
      if (parsed.url) setUrlInput(parsed.url);
      if (parsed.goal) setGoalInput(parsed.goal);
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
          goal: goalInput,
          saved,
        }),
      );
    } catch {
      // ignore
    }
  }, [source, mode, repoInput, repoBInput, urlInput, goalInput, saved]);

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const res = await fetch("/api/mcp-health", { cache: "no-store" });
        const body = (await res.json()) as {
          ok?: boolean;
          version?: string;
          tools?: string[];
        };
        if (!cancelled) {
          setMcpOk(Boolean(body.ok));
          setMcpVersion(typeof body.version === "string" ? body.version : "");
          setMcpTools(Array.isArray(body.tools) ? body.tools : []);
        }
      } catch {
        if (!cancelled) {
          setMcpOk(false);
          setMcpTools([]);
        }
      }
    };
    void ping();
    const id = window.setInterval(ping, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/prompts", { cache: "no-store" });
        const body = (await res.json()) as {
          ui?: PromptUi;
          routes?: string[];
          error?: string;
        };
        if (cancelled || !body.ui) return;
        setPromptUi(body.ui);
        setPromptRoutes(Array.isArray(body.routes) ? body.routes : []);
      } catch {
        // Keep FALLBACK_UI
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoading) return;
    const id = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("brief-desk-error", {
          detail:
            "Run timed out (~90s) without a final answer. Retry once. Prefer Auto demos. Avoid typing custom tool names.",
        }),
      );
    }, RUN_WATCHDOG_MS);
    return () => window.clearTimeout(id);
  }, [isLoading]);

  const hasBriefAuto = mcpTools.includes("brief_auto");
  const hasOrchestrate = mcpTools.includes("brief_orchestrate");
  const mcpReady = mcpOk === true && hasOrchestrate;

  const contextValue = useMemo(() => {
    const note = sessionNote(promptUi, { source, mode, repo, repoB, url });
    return {
      loop: source === "auto" ? "auto→draft→eval" : "orchestrate→draft→eval",
      brief_mode: source === "compare" ? "compare" : mode,
      source_kind: source,
      route: source,
      prompt_routes: promptRoutes,
      mcp_tools: mcpTools,
      has_brief_auto: hasBriefAuto,
      banned_tools: ["brief_workspace"],
      goal: source === "auto" ? goal : null,
      repo: source === "auto" || source === "github" || source === "url" || source === "compare" ? repo : null,
      repo_b: source === "compare" || source === "auto" ? repoB : null,
      url: source === "url" || source === "auto" ? url : null,
      note,
    };
  }, [promptUi, promptRoutes, source, mode, repo, repoB, url, goal, mcpTools, hasBriefAuto]);

  useCopilotReadable({
    description: promptUi.readableDescription,
    value: contextValue,
  });

  const ready =
    (source === "auto" && goal.length >= 8) ||
    (source === "github" && Boolean(repo)) ||
    (source === "url" && Boolean(url)) ||
    (source === "compare" && Boolean(repo) && Boolean(repoB)) ||
    source === "corpus";

  const canRun = ready && mcpReady && !isLoading;

  const runBrief = useCallback(
    async (
      question: string,
      override?: Partial<{
        source: SourceKind;
        mode: BriefMode;
        repo: string | null;
        repoB: string | null;
        url: string | null;
        goal: string | null;
      }>,
    ) => {
      if (isLoading) return;
      if (mcpOk !== true || !hasOrchestrate) {
        window.dispatchEvent(
          new CustomEvent("brief-desk-error", {
            detail: "MCP is offline or missing brief_orchestrate. Redeploy Render, then retry.",
          }),
        );
        return;
      }
      const s = override?.source ?? source;
      const m = override?.mode ?? mode;
      const r = override?.repo !== undefined ? override.repo : repo;
      const rB = override?.repoB !== undefined ? override.repoB : repoB;
      const u = override?.url !== undefined ? override.url : url;
      const g = (override?.goal !== undefined ? override.goal : question || goal)?.trim() || "";
      const sessionReady =
        (s === "auto" && g.length >= 8) ||
        (s === "github" && Boolean(r)) ||
        (s === "url" && Boolean(u)) ||
        (s === "compare" && Boolean(r) && Boolean(rB)) ||
        s === "corpus";
      if (!sessionReady) return;

      setBusyNote(
        s === "auto"
          ? hasBriefAuto
            ? "brief_auto → draft → eval…"
            : "brief_plan → orchestrate → eval…"
          : "orchestrate → eval…",
      );
      try {
        const res = await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: s,
            mode: m,
            repo: r,
            repoB: rB,
            url: u,
            question: s === "auto" ? g : question,
            goal: s === "auto" ? g : undefined,
          }),
        });
        const body = (await res.json()) as { content?: string; error?: string };
        if (!res.ok || !body.content) {
          throw new Error(body.error || "Failed to render start-brief prompt");
        }
        await sendMessage({
          id: crypto.randomUUID(),
          role: "user",
          content: body.content,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Agent run failed";
        window.dispatchEvent(new CustomEvent("brief-desk-error", { detail: message }));
      } finally {
        setBusyNote(null);
      }
    },
    [
      isLoading,
      sendMessage,
      source,
      mode,
      repo,
      repoB,
      url,
      goal,
      mcpOk,
      hasOrchestrate,
      hasBriefAuto,
    ],
  );

  const pinSession = () => {
    if (!ready) return;
    const label =
      source === "auto"
        ? goal.slice(0, 48) || "auto goal"
        : source === "github"
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
          goal: source === "auto" ? goal : undefined,
        },
        ...prev,
      ].slice(0, 8),
    );
  };

  const loadDemo = (demo: PromptUi["demos"][number]) => {
    setSource(demo.source);
    setMode(demo.mode);
    setRepoInput(demo.repo || "");
    setRepoBInput(demo.repoB || "");
    setUrlInput(demo.url || "");
    if (demo.source === "auto") {
      setGoalInput(demo.goal || demo.question);
    }
  };

  const suggest = promptUi.suggest[source] ?? [];
  const modes = promptUi.modes ?? [];
  const demos = promptUi.demos ?? [];
  const defaultQ = promptUi.defaultQuestions;

  const mcpLabel =
    mcpOk === null
      ? "MCP checking…"
      : !mcpOk
        ? "MCP offline · Manual Deploy on Render"
        : !hasOrchestrate
          ? `MCP v${mcpVersion || "?"} · missing tools`
          : hasBriefAuto
            ? `MCP online · v${mcpVersion} · brief_auto`
            : `MCP online · v${mcpVersion} · compat mode`;

  const chatHint = !mcpReady
    ? "Waiting for MCP… if this sticks, Manual Deploy brief-desk on Render."
    : !ready
      ? source === "auto"
        ? "Write a goal with owner/name or https://… then Run agent."
        : "Fill the left panel, click Start brief, or pick a demo."
      : source === "auto"
        ? hasBriefAuto
          ? "Ready. Run agent → brief_auto → draft → eval."
          : "Ready (compat). Run agent → brief_plan → orchestrate → eval."
        : source === "compare"
          ? `Ready to compare ${repo} vs ${repoB}.`
          : source === "url"
            ? "Docs URL ready."
            : source === "corpus"
              ? "Corpus sample ready."
              : `Repo ${repo} · ${mode} ready.`;

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
            Auto mode invents the plan (source, mode, tools) from a goal. Routing lives in{" "}
            <code>prompts/</code>.
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 14,
              fontSize: 12,
              color: mcpOk === null ? "var(--muted)" : mcpReady ? "#15803d" : "#b91c1c",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: mcpOk === null ? "#94a3b8" : mcpReady ? "#22c55e" : "#ef4444",
              }}
            />
            {mcpLabel}
          </div>

          {promptRoutes.length ? (
            <p style={{ margin: "0 0 12px", fontSize: 11, color: "var(--muted)" }}>
              Routes: {promptRoutes.join(" · ")}
            </p>
          ) : null}

          <p style={labelStyle}>QUICK DEMOS</p>
          <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
            {demos.map((d) => (
              <button
                key={d.label}
                type="button"
                disabled={!mcpReady || isLoading}
                onClick={() => {
                  loadDemo(d);
                  void runBrief(d.goal || d.question, {
                    source: d.source,
                    mode: d.mode,
                    repo: d.repo || null,
                    repoB: d.repoB || null,
                    url: d.url || null,
                    goal: d.goal || d.question,
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
                ["auto", "Auto"],
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
                  gridColumn: id === "auto" ? "1 / -1" : undefined,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {source === "auto" ? (
            <>
              <p style={labelStyle}>GOAL</p>
              <textarea
                style={{ ...fieldStyle, minHeight: 96, resize: "vertical", lineHeight: 1.4 }}
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="Include owner/name or https://… The agent invents the rest."
              />
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
                Optional hints below are unused unless you fill them. Prefer putting targets in the
                goal.
              </p>
            </>
          ) : null}

          {source !== "compare" && source !== "corpus" && source !== "auto" ? (
            <>
              <p style={labelStyle}>BRIEF TYPE</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {modes.map((m) => (
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

          {source === "github" || source === "url" || source === "compare" || source === "auto" ? (
            <>
              <p style={{ ...labelStyle, marginTop: source === "auto" ? 12 : 0 }}>
                {source === "compare" ? "REPO A" : source === "auto" ? "HINT REPO (optional)" : "GITHUB REPO"}
              </p>
              <input
                style={fieldStyle}
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="owner/name"
                spellCheck={false}
              />
            </>
          ) : null}

          {source === "compare" || source === "auto" ? (
            <>
              <p style={{ ...labelStyle, marginTop: 12 }}>
                {source === "auto" ? "HINT REPO B (optional)" : "REPO B"}
              </p>
              <input
                style={fieldStyle}
                value={repoBInput}
                onChange={(e) => setRepoBInput(e.target.value)}
                placeholder="owner/name"
                spellCheck={false}
              />
            </>
          ) : null}

          {source === "url" || source === "auto" ? (
            <>
              <p style={{ ...labelStyle, marginTop: 12 }}>
                {source === "auto" ? "HINT URL (optional)" : "PUBLIC DOCS URL"}
              </p>
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
                source === "auto"
                  ? goal
                  : source === "compare"
                    ? suggest[0] || "Compare these repositories."
                    : source === "corpus"
                      ? suggest[0] || "Summarize the sample docs."
                      : source === "url"
                        ? suggest[0] || "Summarize this document for an engineer."
                        : defaultQ?.[mode] || "Give a concise engineering brief with citations.",
                source === "auto" ? { goal } : undefined,
              )
            }
            disabled={!canRun}
            style={{
              marginTop: 14,
              width: "100%",
              padding: "11px 12px",
              borderRadius: 8,
              border: "none",
              background: !canRun ? "#cbd5e1" : "var(--accent)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: !canRun ? "not-allowed" : "pointer",
            }}
          >
            {isLoading || busyNote ? "Running…" : source === "auto" ? "Run agent" : "Start brief"}
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
            {suggest.map((s) => (
              <button
                key={s}
                type="button"
                disabled={!mcpReady || isLoading || (source !== "auto" && !ready)}
                onClick={() => {
                  if (source === "auto") {
                    setGoalInput(s);
                    void runBrief(s, { source: "auto", goal: s });
                    return;
                  }
                  void runBrief(s);
                }}
                style={{
                  ...chipStyle,
                  textAlign: "left",
                  color:
                    !mcpReady || isLoading || (source !== "auto" && !ready)
                      ? "#94a3b8"
                      : "var(--ink)",
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
                        if (s.goal) setGoalInput(s.goal);
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

        <section style={{ minHeight: "100vh", background: "#eef2ff", minWidth: 0, position: "relative" }}>
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
