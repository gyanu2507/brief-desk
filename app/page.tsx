"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCopilotChatInternal, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import { AgentLog } from "./AgentLog";
import { BrandMark } from "./BrandMark";
import { PlanBoard } from "./PlanBoard";
import { RepoCombobox } from "./RepoCombobox";
import { ThemeToggle } from "./theme";
import { ToolCards } from "./ToolCards";
import { LoggingMessages, TranscriptProvider } from "./transcript-bridge";
import { DEFAULT_AUTO_GOAL, FALLBACK_UI } from "../lib/fallback-ui";
import { formatBriefMarkdown } from "../lib/format-brief";
import { expectedSteps, stepsFromNames, type PlanStep } from "../lib/plan-steps";
import {
  isKnownLanguage,
  TRENDING_LANGUAGES,
  TRENDING_SINCE,
} from "../lib/select-options";
import { renderTemplate } from "../lib/template";
import type { BriefMode, PromptUi, SourceKind } from "../lib/types";

function emitPlan(detail: { steps?: PlanStep[]; note?: string | null; active?: boolean }) {
  window.dispatchEvent(new CustomEvent("brief-desk-plan", { detail }));
}

const STORE_KEY = "brief-desk-v4";
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
  if (args.source === "trending") return notes.trending || "Use brief_github_trending, then brief_eval.";
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

export default function Page() {
  const { isLoading, appendMessage, stopGeneration } = useCopilotChatInternal();
  const [source, setSource] = useState<SourceKind>("auto");
  const [mode, setMode] = useState<BriefMode>("overview");
  const [repoInput, setRepoInput] = useState("");
  const [repoBInput, setRepoBInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [languageInput, setLanguageInput] = useState("typescript");
  const [sinceInput, setSinceInput] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [goalInput, setGoalInput] = useState(DEFAULT_AUTO_GOAL);
  const [saved, setSaved] = useState<SavedBrief[]>([]);
  const [mcpOk, setMcpOk] = useState<boolean | null>(null);
  const [mcpVersion, setMcpVersion] = useState<string>("");
  const [mcpTools, setMcpTools] = useState<string[]>([]);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
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
        language?: string;
        since?: "daily" | "weekly" | "monthly";
        saved?: SavedBrief[];
      };
      if (parsed.source) setSource(parsed.source);
      if (parsed.mode) setMode(parsed.mode);
      if (parsed.repo) setRepoInput(parsed.repo);
      if (parsed.repoB) setRepoBInput(parsed.repoB);
      if (parsed.url) setUrlInput(parsed.url);
      if (parsed.goal) setGoalInput(parsed.goal);
      if (typeof parsed.language === "string" && isKnownLanguage(parsed.language)) {
        setLanguageInput(parsed.language);
      }
      if (parsed.since === "daily" || parsed.since === "weekly" || parsed.since === "monthly") {
        setSinceInput(parsed.since);
      }
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
          language: languageInput,
          since: sinceInput,
          saved,
        }),
      );
    } catch {
      // ignore
    }
  }, [source, mode, repoInput, repoBInput, urlInput, goalInput, languageInput, sinceInput, saved]);

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
        const next = body.ui;
        setPromptUi({
          ...FALLBACK_UI,
          ...next,
          modes: next.modes?.length ? next.modes : FALLBACK_UI.modes,
          defaultQuestions: { ...FALLBACK_UI.defaultQuestions, ...next.defaultQuestions },
          suggest: { ...FALLBACK_UI.suggest, ...next.suggest },
          sessionNotes: { ...FALLBACK_UI.sessionNotes, ...next.sessionNotes },
          demos: next.demos?.length ? next.demos : FALLBACK_UI.demos,
        });
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

  useEffect(() => {
    const active = pipelineBusy || isLoading;
    window.dispatchEvent(
      new CustomEvent("brief-desk-processing", {
        detail: {
          active,
          note: active
            ? busyNote || (pipelineBusy ? "Gathering evidence and drafting…" : "Agent thinking…")
            : null,
        },
      }),
    );
  }, [pipelineBusy, isLoading, busyNote]);

  const hasBriefAuto = mcpTools.includes("brief_auto");
  const hasOrchestrate = mcpTools.includes("brief_orchestrate");
  const mcpReady = mcpOk === true && hasOrchestrate;
  // Keep controls usable while the first health ping is in flight.
  const mcpBlocked = mcpOk === false || (mcpOk === true && !hasOrchestrate);

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
    source === "corpus" ||
    source === "trending";

  const canRun = ready && !mcpBlocked && !isLoading && !pipelineBusy;
  const canCancel = pipelineBusy || isLoading;

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    try {
      stopGeneration();
    } catch {
      // ignore if no free-form run
    }
    setBusyNote(null);
    setPipelineBusy(false);
    emitPlan({
      active: false,
      note: "Cancelled",
      steps: expectedSteps(source, hasBriefAuto).map((s) => ({
        ...s,
        state: s.state === "done" ? "done" : "skipped",
      })),
    });
    window.dispatchEvent(
      new CustomEvent("brief-desk-error", { detail: "Run cancelled." }),
    );
  }, [source, hasBriefAuto, stopGeneration]);

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
        language: string | null;
        since: string | null;
      }>,
    ) => {
      if (isLoading || pipelineBusy) return;
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
      const lang =
        override?.language !== undefined ? override.language : languageInput.trim() || null;
      const since = override?.since !== undefined ? override.since : sinceInput;
      const g = (override?.goal !== undefined ? override.goal : question || goal)?.trim() || "";
      const sessionReady =
        (s === "auto" && g.length >= 8) ||
        (s === "github" && Boolean(r)) ||
        (s === "url" && Boolean(u)) ||
        (s === "compare" && Boolean(r) && Boolean(rB)) ||
        s === "corpus" ||
        s === "trending";
      if (!sessionReady) return;

      // Show the prompt in CopilotChat, then fill the reply via /api/brief-run
      // (reliable). followUp:false so we do not also fire the free-form agent.
      const userFacing = (s === "auto" || s === "trending" ? g || question : question).trim();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const planned = expectedSteps(s, hasBriefAuto).map((step, i) =>
        i === 0 ? { ...step, state: "active" as const } : step,
      );
      setPipelineBusy(true);
      setBusyNote(
        s === "auto"
          ? hasBriefAuto
            ? "brief_auto → draft → eval…"
            : "brief_plan → orchestrate → eval…"
          : s === "trending"
            ? "trending → draft → eval…"
            : "orchestrate → draft → eval…",
      );
      emitPlan({ steps: planned, note: "Gathering…", active: true });

      try {
        await appendMessage(new TextMessage({ role: Role.User, content: userFacing }), {
          followUp: false,
        });

        const res = await fetch("/api/brief-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: s,
            mode: m,
            repo: r,
            repoB: rB,
            url: u,
            language: s === "trending" ? lang : undefined,
            since: s === "trending" ? since : undefined,
            question: s === "auto" || s === "trending" ? g || question : question,
            goal: s === "auto" || s === "trending" ? g || question : undefined,
          }),
          signal: controller.signal,
        });
        const body = (await res.json()) as {
          ok?: boolean;
          answer?: string;
          steps?: string[];
          error?: string;
          ms?: number;
          eval?: { pass?: boolean; scores?: { overall?: number } };
        };
        if (!res.ok || !body.ok || !body.answer) {
          throw new Error(body.error || "brief-run failed");
        }
        const score =
          typeof body.eval?.scores?.overall === "number"
            ? `eval ${body.eval.scores.overall}`
            : body.eval?.pass === true
              ? "eval pass"
              : null;
        const meta = [`${(body.steps || []).join(" → ")}`, score, `${body.ms ?? "?"}ms`]
          .filter(Boolean)
          .join(" · ");
        const markdown = formatBriefMarkdown(body.answer, meta);
        await appendMessage(new TextMessage({ role: Role.Assistant, content: markdown }), {
          followUp: false,
        });
        emitPlan({
          active: false,
          note: `${body.ms ?? "?"}ms`,
          steps: stepsFromNames(body.steps || ["done"]),
        });
        window.dispatchEvent(
          new CustomEvent("brief-desk-answer", {
            detail: { answer: body.answer, steps: body.steps, ms: body.ms },
          }),
        );
      } catch (e) {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          await appendMessage(
            new TextMessage({
              role: Role.Assistant,
              content: "**Cancelled.** You can start another brief when ready.",
            }),
            { followUp: false },
          ).catch(() => undefined);
          return;
        }
        const message = e instanceof Error ? e.message : "brief-run failed";
        emitPlan({
          active: false,
          note: message,
          steps: planned.map((step, i) =>
            i === 0 ? { ...step, state: "error" as const } : { ...step, state: "skipped" as const },
          ),
        });
        await appendMessage(
          new TextMessage({
            role: Role.Assistant,
            content: `**Could not finish the brief.**\n\n${message}`,
          }),
          { followUp: false },
        ).catch(() => undefined);
        window.dispatchEvent(new CustomEvent("brief-desk-error", { detail: message }));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusyNote(null);
        setPipelineBusy(false);
      }
    },
    [
      isLoading,
      pipelineBusy,
      source,
      mode,
      repo,
      repoB,
      url,
      goal,
      mcpOk,
      hasOrchestrate,
      hasBriefAuto,
      languageInput,
      sinceInput,
      appendMessage,
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

  const suggest =
    promptUi.suggest[source]?.length > 0
      ? promptUi.suggest[source]
      : FALLBACK_UI.suggest[source] ?? [];
  const modes = promptUi.modes?.length ? promptUi.modes : FALLBACK_UI.modes;
  const demos = promptUi.demos?.length ? promptUi.demos : FALLBACK_UI.demos;
  const defaultQ = { ...FALLBACK_UI.defaultQuestions, ...promptUi.defaultQuestions };

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
        : source === "trending"
          ? `Ready. Trending ${
              TRENDING_LANGUAGES.find((o) => o.value === languageInput)?.label || "Any"
            } · ${TRENDING_SINCE.find((o) => o.value === sinceInput)?.label || sinceInput}.`
          : source === "compare"
            ? `Ready to compare ${repo} vs ${repoB}.`
            : source === "url"
              ? "Docs URL ready."
              : source === "corpus"
                ? "Corpus sample ready."
                : `Repo ${repo} · ${mode} ready.`;

  const startQuestion =
    source === "auto"
      ? goal
      : source === "trending"
        ? suggest[0] ||
          `Rank trending ${languageInput || "any"} repos (${sinceInput}) for an engineering team.`
        : source === "compare"
          ? suggest[0] || "Compare these repositories."
          : source === "corpus"
            ? suggest[0] || "Summarize the sample docs."
            : source === "url"
              ? suggest[0] || "Summarize this document for an engineer."
              : defaultQ?.[mode] || "Give a concise engineering brief with citations.";

  return (
    <TranscriptProvider>
      <ToolCards />
      <main className="desk-shell">
        <aside className="desk-controls">
          <div className="brand-row">
            <div className="brand-left">
              <BrandMark size={32} />
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    color: "var(--muted)",
                    fontWeight: 600,
                  }}
                >
                  BRIEF-DESK
                </p>
                <h1 style={{ margin: "2px 0 0", fontSize: 20, lineHeight: 1.2 }}>
                  Multi-source briefing
                </h1>
              </div>
            </div>
            <ThemeToggle />
          </div>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13, lineHeight: 1.4 }}>
            One repo. GitHub, docs URLs, compare, or bundled corpus. Run agent drafts a brief with
            citations.
          </p>

          <div
            className="status-row"
            style={{
              color: mcpOk === null ? "var(--muted)" : mcpReady ? "var(--ok)" : "var(--bad)",
            }}
          >
            <span
              className="status-dot"
              style={{
                background: mcpOk === null ? "var(--muted)" : mcpReady ? "var(--ok)" : "var(--bad)",
              }}
            />
            {mcpLabel}
          </div>

          <p className="section-label">Source</p>
          <div className="source-grid">
            {(
              [
                ["auto", "Auto"],
                ["trending", "Trending"],
                ["github", "GitHub"],
                ["url", "Docs"],
                ["compare", "Compare"],
                ["corpus", "Corpus"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`chip${source === id ? " active" : ""}${id === "auto" ? " span-all" : ""}`}
                onClick={() => setSource(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {source === "trending" ? (
            <>
              <p className="section-label">Language</p>
              <select
                className="field field-select"
                value={languageInput}
                onChange={(e) => setLanguageInput(e.target.value)}
                aria-label="Trending language"
              >
                {TRENDING_LANGUAGES.map((opt) => (
                  <option key={opt.value || "any"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="section-label">Window</p>
              <select
                className="field field-select"
                value={sinceInput}
                onChange={(e) =>
                  setSinceInput(e.target.value as "daily" | "weekly" | "monthly")
                }
                aria-label="Trending time window"
              >
                {TRENDING_SINCE.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}

          {source === "auto" ? (
            <>
              <p className="section-label">Goal</p>
              <textarea
                className="field"
                style={{ minHeight: 80, resize: "vertical", lineHeight: 1.4 }}
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="Include owner/name or https://…"
              />
            </>
          ) : null}

          {source !== "auto" &&
          source !== "compare" &&
          source !== "corpus" &&
          source !== "trending" ? (
            <>
              <p className="section-label">Brief type</p>
              <select
                className="field field-select"
                value={mode}
                onChange={(e) => setMode(e.target.value as BriefMode)}
                aria-label="Brief type"
              >
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}

          {source === "github" || source === "url" || source === "compare" ? (
            <RepoCombobox
              label={source === "compare" ? "Repo A" : "GitHub repo"}
              value={repoInput}
              onChange={setRepoInput}
              savedRepos={saved
                .map((s) => s.repo)
                .filter((r): r is string => Boolean(r))}
            />
          ) : null}

          {source === "compare" ? (
            <RepoCombobox
              label="Repo B"
              value={repoBInput}
              onChange={setRepoBInput}
              savedRepos={saved
                .flatMap((s) => [s.repo, s.repoB])
                .filter((r): r is string => Boolean(r))}
            />
          ) : null}

          {source === "url" ? (
            <>
              <p className="section-label">Docs URL</p>
              <input
                className="field"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://…"
                spellCheck={false}
              />
            </>
          ) : null}

          {source === "corpus" ? (
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>
              Bundled sample docs in this repo (<code>mcp/corpus</code>).
            </p>
          ) : null}

          <div className="query-panel">
            <p className="section-label">Queries</p>
            <div className="query-list">
              {suggest.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                  No queries for this source.
                </p>
              ) : (
                suggest.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chip"
                    disabled={mcpBlocked || pipelineBusy || (source !== "auto" && !ready)}
                    onClick={() => {
                      if (source === "auto") {
                        setGoalInput(s);
                        void runBrief(s, { source: "auto", goal: s });
                        return;
                      }
                      void runBrief(s);
                    }}
                  >
                    {s}
                  </button>
                ))
              )}
            </div>
          </div>

          <button
            type="button"
            className="btn-primary"
            disabled={!canRun}
            onClick={() =>
              void runBrief(startQuestion, source === "auto" ? { goal } : undefined)
            }
          >
            {pipelineBusy || busyNote
              ? "Running…"
              : source === "auto"
                ? "Run agent"
                : source === "trending"
                  ? "Rank trending"
                  : "Start brief"}
          </button>

          {canCancel ? (
            <button type="button" className="btn-danger" onClick={cancelRun}>
              Cancel run
            </button>
          ) : null}

          <PlanBoard />

          <button
            type="button"
            className="btn-secondary"
            onClick={pinSession}
            disabled={!ready}
          >
            Save session shortcut
          </button>

          <p className="section-label" style={{ marginTop: 18 }}>
            Demos
          </p>
          <div className="demo-list">
            {demos.map((d) => (
              <button
                key={d.label}
                type="button"
                className="chip"
                disabled={mcpBlocked || pipelineBusy}
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
              >
                {d.label}
              </button>
            ))}
          </div>

          {saved.length ? (
            <>
              <p className="section-label">Saved</p>
              <div className="demo-list">
                {saved.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="chip"
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: 11,
                    }}
                    onClick={() => {
                      setSource(s.source);
                      setMode(s.mode);
                      setRepoInput(s.repo || (s.source === "github" ? s.label : ""));
                      setRepoBInput(s.repoB || "");
                      setUrlInput(s.url || (s.source === "url" ? s.label : ""));
                      if (s.goal) setGoalInput(s.goal);
                    }}
                  >
                    {s.source} · {s.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </aside>

        <section className="desk-main">
          <div style={{ flex: 1, minHeight: 0 }} className="desk-chat">
            <CopilotChat
              labels={{
                title: "brief-desk",
                initial: chatHint,
              }}
              className="h-full"
              Messages={LoggingMessages}
            />
          </div>
        </section>
        <AgentLog />
      </main>
    </TranscriptProvider>
  );
}
