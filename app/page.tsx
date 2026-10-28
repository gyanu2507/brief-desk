"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCopilotChatInternal, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import type { User } from "@supabase/supabase-js";
import { AgentLog } from "./AgentLog";
import { AuthButton } from "./AuthButton";
import { BrandMark } from "./BrandMark";
import { BriefExportBar } from "./BriefExportBar";
import { BriefEvalPanel } from "./BriefEval";
import { BriefGroundingPanel } from "./BriefGrounding";
import { BriefHistory } from "./BriefHistory";
import { BriefRunStatus } from "./BriefRunStatus";
import { PlanBoard } from "./PlanBoard";
import { ReleaseDiffPanel } from "./ReleaseDiffPanel";
import { RepoCombobox } from "./RepoCombobox";
import { ThemeToggle } from "./theme";
import { ToolCards } from "./ToolCards";
import { TrendingPicker, type TrendingRow } from "./TrendingPicker";
import {
  LoggingMessages,
  TranscriptProvider,
  usePinnedChat,
} from "./transcript-bridge";
import {
  HISTORY_MAX,
  historyLabel,
  loadBriefHistory,
  pushBriefHistory,
  saveBriefHistory,
  type BriefHistoryEntry,
} from "../lib/brief-history";
import { CANCELLED_MESSAGE } from "../lib/abort";
import { evalOverallScore } from "../lib/brief-run";
import { runBriefViaApi } from "../lib/brief-run-client";
import {
  formatGroundingMarkdown,
  parseGrounding,
  type BriefGrounding,
} from "../lib/citations";
import {
  formatEvalMarkdown,
  parseEvalView,
  type EvalView,
} from "../lib/eval-display";
import { DEFAULT_AUTO_GOAL, FALLBACK_UI } from "../lib/fallback-ui";
import { formatBriefMarkdown } from "../lib/format-brief";
import type { RunObservability } from "../lib/run-observability";
import { expectedSteps, stepsFromNames, type PlanStep } from "../lib/plan-steps";
import { loadLocalSaved, SAVED_MAX, type SavedBrief } from "../lib/saved-shortcuts";
import {
  isKnownLanguage,
  normalizePackageName,
  PACKAGE_REGISTRIES,
  TRENDING_LANGUAGES,
  TRENDING_SINCE,
} from "../lib/select-options";
import {
  buildSessionSearch,
  buildSessionUrl,
  parseSessionSearch,
  type SessionLinkState,
} from "../lib/session-link";
import {
  clearRemoteHistory,
  fetchRemoteHistory,
  fetchRemoteSaved,
  pushRemoteHistory,
  pushRemoteSaved,
} from "../lib/sync-api";
import { mergeByIdAt } from "../lib/sync-merge";
import { renderTemplate } from "../lib/template";
import type { BriefMode, PackageRegistry, PromptUi, SourceKind } from "../lib/types";

type RunOverride = Partial<{
  source: SourceKind;
  mode: BriefMode;
  repo: string | null;
  repoB: string | null;
  url: string | null;
  goal: string | null;
  language: string | null;
  since: string | null;
  packageName: string | null;
  packageRegistry: PackageRegistry;
  tagA: string | null;
  tagB: string | null;
}>;

function emitPlan(detail: { steps?: PlanStep[]; note?: string | null; active?: boolean }) {
  window.dispatchEvent(new CustomEvent("brief-desk-plan", { detail }));
}

const STORE_KEY = "brief-desk-v4";
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_WATCHDOG_MS = 90_000;

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
    packageName: string | null;
    packageRegistry: PackageRegistry;
    tagA: string | null;
    tagB: string | null;
  },
): string {
  const notes = ui.sessionNotes;
  if (args.source === "auto") return notes.auto;
  if (args.source === "trending") return notes.trending || "Use brief_github_trending, then brief_eval.";
  if (args.source === "package") {
    return args.packageName
      ? renderTemplate(notes.package_ready || "Call brief_{{registry}}_package name={{package}}.", {
          registry: args.packageRegistry,
          package: args.packageName,
        })
      : notes.package_missing || "Pick npm or PyPI and a package name.";
  }
  if (args.source === "releases") {
    return args.repo && args.tagA && args.tagB
      ? renderTemplate(
          notes.releases_ready ||
            "Call brief_repo_release_diff repo={{repo}} tag_a={{tag_a}} tag_b={{tag_b}}.",
          { repo: args.repo, tag_a: args.tagA, tag_b: args.tagB },
        )
      : notes.releases_missing || "Pick a repo and two release tags.";
  }
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

function applySessionLink(
  state: SessionLinkState,
  setters: {
    setSource: (v: SourceKind) => void;
    setMode: (v: BriefMode) => void;
    setRepoInput: (v: string) => void;
    setRepoBInput: (v: string) => void;
    setUrlInput: (v: string) => void;
    setGoalInput: (v: string) => void;
    setLanguageInput: (v: string) => void;
    setSinceInput: (v: "daily" | "weekly" | "monthly") => void;
    setPackageRegistry: (v: PackageRegistry) => void;
    setPackageInput: (v: string) => void;
    setTagA: (v: string) => void;
    setTagB: (v: string) => void;
  },
) {
  setters.setSource(state.source);
  if (state.mode) setters.setMode(state.mode);
  if (state.repo) setters.setRepoInput(state.repo);
  if (state.repoB) setters.setRepoBInput(state.repoB);
  if (state.url) setters.setUrlInput(state.url);
  if (state.goal) setters.setGoalInput(state.goal);
  if (state.language && isKnownLanguage(state.language)) {
    setters.setLanguageInput(state.language);
  }
  if (state.since) setters.setSinceInput(state.since);
  if (state.packageRegistry) setters.setPackageRegistry(state.packageRegistry);
  if (state.packageName) setters.setPackageInput(state.packageName);
  if (state.tagA) setters.setTagA(state.tagA);
  if (state.tagB) setters.setTagB(state.tagB);
}

function messageRole(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const role = (msg as { role?: string }).role;
  return typeof role === "string" ? role.toLowerCase() : "";
}

function messageText(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function chatMessagesFromHistory(entry: BriefHistoryEntry) {
  const q = entry.question || entry.label || "Brief";
  const stamp = entry.at || Date.now();
  return {
    question: q,
    messages: [
      {
        id: `hist-u-${entry.id}-${stamp}`,
        role: "user" as const,
        content: q,
      },
      {
        id: `hist-a-${entry.id}-${stamp}`,
        role: "assistant" as const,
        content: entry.markdown,
      },
    ],
  };
}

export default function Page() {
  return (
    <TranscriptProvider>
      <DeskPage />
    </TranscriptProvider>
  );
}

function DeskPage() {
  const { isLoading, appendMessage, stopGeneration, messages } = useCopilotChatInternal();
  const { setPinned } = usePinnedChat();
  const [source, setSource] = useState<SourceKind>("auto");
  const [mode, setMode] = useState<BriefMode>("overview");
  const [repoInput, setRepoInput] = useState("");
  const [repoBInput, setRepoBInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [languageInput, setLanguageInput] = useState("typescript");
  const [sinceInput, setSinceInput] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [packageRegistry, setPackageRegistry] = useState<PackageRegistry>("npm");
  const [packageInput, setPackageInput] = useState("zod");
  const [tagA, setTagA] = useState("");
  const [tagB, setTagB] = useState("");
  const [trendingSeed, setTrendingSeed] = useState<TrendingRow[]>([]);
  const [goalInput, setGoalInput] = useState(DEFAULT_AUTO_GOAL);
  const [saved, setSaved] = useState<SavedBrief[]>([]);
  const [history, setHistory] = useState<BriefHistoryEntry[]>([]);
  const [lastMarkdown, setLastMarkdown] = useState<string | null>(null);
  const [lastGrounding, setLastGrounding] = useState<BriefGrounding | null>(null);
  const [lastEvalView, setLastEvalView] = useState<EvalView | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [lastObservability, setLastObservability] = useState<RunObservability | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [cloudUserId, setCloudUserId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const skipUrlWrite = useRef(true);
  const skipPersist = useRef(true);
  const skipCloudWrite = useRef(true);
  const syncInFlight = useRef(false);
  const lastSyncedUserId = useRef<string | null>(null);
  const historyRef = useRef<BriefHistoryEntry[]>([]);
  const savedRef = useRef<SavedBrief[]>([]);
  const skipNextChatHistory = useRef(false);
  const prevChatLoading = useRef(false);
  const lastChatHistoryKey = useRef("");
  const [mcpOk, setMcpOk] = useState<boolean | null>(null);
  const [mcpVersion, setMcpVersion] = useState<string>("");
  const [mcpTools, setMcpTools] = useState<string[]>([]);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRunRef = useRef<{ question: string; override?: RunOverride } | null>(null);
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
  const packageName = normalizePackageName(packageInput, packageRegistry);
  const goal = goalInput.trim();

  useEffect(() => {
    let bootHistory: BriefHistoryEntry[] = [];
    try {
      bootHistory = loadBriefHistory();
      setHistory(bootHistory);
      const fromUrl = parseSessionSearch(
        typeof window !== "undefined" ? window.location.search : "",
      );
      if (fromUrl) {
        applySessionLink(fromUrl, {
          setSource,
          setMode,
          setRepoInput,
          setRepoBInput,
          setUrlInput,
          setGoalInput,
          setLanguageInput,
          setSinceInput,
          setPackageRegistry,
          setPackageInput,
          setTagA,
          setTagB,
        });
      } else {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) {
          const legacy = localStorage.getItem("brief-desk-repo");
          if (legacy) setRepoInput(legacy);
        } else {
          const parsed = JSON.parse(raw) as {
            source?: SourceKind;
            mode?: BriefMode;
            repo?: string;
            repoB?: string;
            url?: string;
            goal?: string;
            language?: string;
            since?: "daily" | "weekly" | "monthly";
            packageRegistry?: PackageRegistry;
            packageName?: string;
            tagA?: string;
            tagB?: string;
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
          if (parsed.packageRegistry === "npm" || parsed.packageRegistry === "pypi") {
            setPackageRegistry(parsed.packageRegistry);
          }
          if (typeof parsed.packageName === "string" && parsed.packageName.trim()) {
            setPackageInput(parsed.packageName);
          }
          if (typeof parsed.tagA === "string") setTagA(parsed.tagA);
          if (typeof parsed.tagB === "string") setTagB(parsed.tagB);
          if (Array.isArray(parsed.saved)) setSaved(parsed.saved.slice(0, SAVED_MAX));
        }
      }
      // Still restore saved shortcuts from localStorage even when URL wins.
      const rawSaved = localStorage.getItem(STORE_KEY);
      if (rawSaved && fromUrl) {
        try {
          const parsed = JSON.parse(rawSaved) as { saved?: SavedBrief[] };
          if (Array.isArray(parsed.saved)) setSaved(parsed.saved.slice(0, SAVED_MAX));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    // Pin latest History into the chat UI (survives CopilotKit wiping its thread).
    const latest = bootHistory[0];
    if (latest?.markdown) {
      skipNextChatHistory.current = true;
      setLastMarkdown(latest.markdown);
      const { question } = chatMessagesFromHistory(latest);
      setPinned({
        id: latest.id,
        user: question,
        assistant: latest.markdown,
      });
    }
    // Defer persists until after hydrate, otherwise empty [] state wipes localStorage.
    const t = window.setTimeout(() => {
      skipPersist.current = false;
      skipUrlWrite.current = false;
    }, 0);
    return () => window.clearTimeout(t);
  }, [setPinned]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  const handleUserChange = useCallback(async (user: User | null) => {
    const uid = user?.id ?? null;
    setCloudUserId(uid);
    if (!uid) {
      lastSyncedUserId.current = null;
      skipCloudWrite.current = true;
      syncInFlight.current = false;
      setSyncError(null);
      return;
    }
    if (lastSyncedUserId.current === uid) return;
    // Wait until hydrate so we don't merge against a wiped empty store.
    if (skipPersist.current) {
      window.setTimeout(() => {
        void handleUserChange(user);
      }, 50);
      return;
    }
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    skipCloudWrite.current = true;
    try {
      const [remoteHistory, remoteSaved] = await Promise.all([
        fetchRemoteHistory(),
        fetchRemoteSaved(),
      ]);

      if (!remoteHistory.ok || !remoteSaved.ok) {
        const err =
          (!remoteHistory.ok && remoteHistory.error) ||
          (!remoteSaved.ok && remoteSaved.error) ||
          "sync failed";
        const hint =
          /relation|does not exist|schema cache/i.test(err)
            ? "Run supabase/schema.sql in the Supabase SQL editor, then refresh."
            : err;
        setSyncError(hint);
        const localHistory = loadBriefHistory();
        const localSaved = loadLocalSaved(STORE_KEY);
        if (localHistory.length) setHistory(localHistory);
        if (localSaved.length) setSaved(localSaved);
        return;
      }

      // Re-read disk + in-memory right before merge so a brief that finished
      // during the network round-trip is not overwritten by a stale merge.
      const localHistory = mergeByIdAt(
        loadBriefHistory(),
        historyRef.current,
        HISTORY_MAX,
      );
      const localSaved = mergeByIdAt(loadLocalSaved(STORE_KEY), savedRef.current, SAVED_MAX);
      const mergedHistory = mergeByIdAt(localHistory, remoteHistory.entries, HISTORY_MAX);
      const mergedSaved = mergeByIdAt(localSaved, remoteSaved.entries, SAVED_MAX);
      setHistory(mergedHistory);
      setSaved(mergedSaved);
      const [pushedH, pushedS] = await Promise.all([
        pushRemoteHistory(mergedHistory),
        pushRemoteSaved(mergedSaved),
      ]);
      if (!pushedH || !pushedS) {
        setSyncError(
          "Could not write history to Supabase. Confirm schema.sql was run, then refresh.",
        );
        return;
      }
      setSyncError(null);
      lastSyncedUserId.current = uid;
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "sync failed");
    } finally {
      skipCloudWrite.current = false;
      syncInFlight.current = false;
      // Persist anything that landed while skipCloudWrite was true.
      window.setTimeout(() => {
        if (!uid) return;
        void pushRemoteHistory(historyRef.current);
        void pushRemoteSaved(savedRef.current);
      }, 0);
    }
  }, []);

  useEffect(() => {
    if (skipPersist.current) return;
    saveBriefHistory(history);
    if (!cloudUserId || skipCloudWrite.current) return;
    const t = window.setTimeout(() => {
      void pushRemoteHistory(history);
    }, 400);
    return () => window.clearTimeout(t);
  }, [history, cloudUserId]);

  useEffect(() => {
    if (skipPersist.current) return;
    if (!cloudUserId || skipCloudWrite.current) return;
    const t = window.setTimeout(() => {
      void pushRemoteSaved(saved);
    }, 400);
    return () => window.clearTimeout(t);
  }, [saved, cloudUserId]);

  // Free-form chat never hit /api/brief-run, so History stayed empty for most runs.
  useEffect(() => {
    const wasLoading = prevChatLoading.current;
    prevChatLoading.current = isLoading;
    if (!wasLoading || isLoading || pipelineBusy) return;
    if (skipNextChatHistory.current) {
      skipNextChatHistory.current = false;
      return;
    }
    const list = Array.isArray(messages) ? messages : [];
    let assistantIdx = -1;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const role = messageRole(list[i]);
      if (role === "assistant" || role === "ai") {
        assistantIdx = i;
        break;
      }
    }
    if (assistantIdx < 0) return;
    const answer = messageText(list[assistantIdx]).trim();
    if (!answer) return;
    let question = "";
    for (let i = assistantIdx - 1; i >= 0; i -= 1) {
      const role = messageRole(list[i]);
      if (role === "user" || role === "human") {
        question = messageText(list[i]).trim();
        break;
      }
    }
    const key = `${question}\n---\n${answer.slice(0, 240)}`;
    if (lastChatHistoryKey.current === key) return;
    lastChatHistoryKey.current = key;
    const markdown = formatBriefMarkdown(answer, "chat");
    setLastMarkdown(markdown);
    setHistory((prev) =>
      pushBriefHistory(prev, {
        source,
        mode: source === "compare" ? "general" : mode,
        label: historyLabel({
          source,
          repo,
          goal,
          question: question || answer.slice(0, 56),
          packageName,
          packageRegistry,
          tagA,
          tagB,
        }),
        question: question || "(chat)",
        answer,
        markdown,
        meta: "chat",
        repo: repo || undefined,
        repoB: repoB || undefined,
        url: url || undefined,
        goal: source === "auto" || source === "trending" ? goal || undefined : undefined,
        packageName: source === "package" ? packageName || undefined : undefined,
        packageRegistry: source === "package" ? packageRegistry : undefined,
        tagA: source === "releases" ? tagA || undefined : undefined,
        tagB: source === "releases" ? tagB || undefined : undefined,
      }),
    );
  }, [
    isLoading,
    messages,
    pipelineBusy,
    source,
    mode,
    repo,
    repoB,
    url,
    goal,
    packageName,
    packageRegistry,
    tagA,
    tagB,
  ]);

  useEffect(() => {
    if (skipPersist.current) return;
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
          packageRegistry,
          packageName: packageInput,
          tagA,
          tagB,
          saved,
        }),
      );
    } catch {
      // ignore
    }
  }, [
    source,
    mode,
    repoInput,
    repoBInput,
    urlInput,
    goalInput,
    languageInput,
    sinceInput,
    packageRegistry,
    packageInput,
    tagA,
    tagB,
    saved,
  ]);

  const sessionLinkState = useMemo<SessionLinkState>(
    () => ({
      source,
      mode,
      repo: repoInput.trim() || undefined,
      repoB: repoBInput.trim() || undefined,
      url: urlInput.trim() || undefined,
      goal: goalInput.trim() || undefined,
      language: languageInput,
      since: sinceInput,
      packageRegistry,
      packageName: packageInput.trim() || undefined,
      tagA: tagA.trim() || undefined,
      tagB: tagB.trim() || undefined,
    }),
    [
      source,
      mode,
      repoInput,
      repoBInput,
      urlInput,
      goalInput,
      languageInput,
      sinceInput,
      packageRegistry,
      packageInput,
      tagA,
      tagB,
    ],
  );

  useEffect(() => {
    if (skipUrlWrite.current) return;
    const next = buildSessionSearch(sessionLinkState);
    const path = window.location.pathname || "/";
    const target = next ? `${path}?${next}` : path;
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [sessionLinkState]);

  const copySessionLink = useCallback(async () => {
    const href = buildSessionUrl(
      window.location.origin,
      window.location.pathname || "/",
      sessionLinkState,
    );
    try {
      await navigator.clipboard.writeText(href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      // ignore
    }
  }, [sessionLinkState]);

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
  const hasTrendingTool = mcpTools.includes("brief_github_trending");
  const mcpReady = mcpOk === true && hasOrchestrate;
  // Keep controls usable while the first health ping is in flight.
  const mcpBlocked = mcpOk === false || (mcpOk === true && !hasOrchestrate);
  const mcpVersionWarn =
    mcpOk === true && source === "trending" && !hasTrendingTool
      ? `MCP v${mcpVersion || "?"} is missing brief_github_trending. Redeploy Render (Dockerfile) to 0.10.0+.`
      : null;

  const contextValue = useMemo(() => {
    const note = sessionNote(promptUi, {
      source,
      mode,
      repo,
      repoB,
      url,
      packageName,
      packageRegistry,
      tagA: tagA.trim() || null,
      tagB: tagB.trim() || null,
    });
    return {
      loop:
        source === "auto"
          ? "auto→draft→eval"
          : source === "package"
            ? "package→draft→eval"
            : source === "releases"
              ? "release_diff→draft→eval"
              : "orchestrate→draft→eval",
      brief_mode: source === "compare" ? "compare" : mode,
      source_kind: source,
      route: source,
      prompt_routes: promptRoutes,
      mcp_tools: mcpTools,
      has_brief_auto: hasBriefAuto,
      goal: source === "auto" ? goal : null,
      repo:
        source === "auto" ||
        source === "github" ||
        source === "url" ||
        source === "compare" ||
        source === "releases"
          ? repo
          : null,
      repo_b: source === "compare" || source === "auto" ? repoB : null,
      url: source === "url" || source === "auto" ? url : null,
      package_name: source === "package" ? packageName : null,
      package_registry: source === "package" ? packageRegistry : null,
      tag_a: source === "releases" ? tagA.trim() || null : null,
      tag_b: source === "releases" ? tagB.trim() || null : null,
      note,
    };
  }, [
    promptUi,
    promptRoutes,
    source,
    mode,
    repo,
    repoB,
    url,
    packageName,
    packageRegistry,
    tagA,
    tagB,
    goal,
    mcpTools,
    hasBriefAuto,
  ]);

  useCopilotReadable({
    description: promptUi.readableDescription,
    value: contextValue,
  });

  const ready =
    (source === "auto" && goal.length >= 8) ||
    (source === "github" && Boolean(repo)) ||
    (source === "url" && Boolean(url)) ||
    (source === "compare" && Boolean(repo) && Boolean(repoB)) ||
    (source === "package" && Boolean(packageName)) ||
    (source === "releases" &&
      Boolean(repo) &&
      Boolean(tagA.trim()) &&
      Boolean(tagB.trim()) &&
      tagA.trim() !== tagB.trim()) ||
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
    setRunError(null);
    setLastGrounding(null);
    setLastEvalView(null);
    emitPlan({
      active: false,
      note: "Cancelled",
      steps: expectedSteps(source, hasBriefAuto, { packageRegistry }).map((s) => ({
        ...s,
        state: s.state === "done" ? "done" : "skipped",
      })),
    });
    window.dispatchEvent(
      new CustomEvent("brief-desk-error", { detail: CANCELLED_MESSAGE }),
    );
  }, [source, hasBriefAuto, packageRegistry, stopGeneration]);

  const runBrief = useCallback(
    async (question: string, override?: RunOverride) => {
      if (isLoading || pipelineBusy) return;
      if (mcpOk !== true || !hasOrchestrate) {
        const detail =
          "MCP is offline or missing brief_orchestrate. Redeploy Render, then retry.";
        setRunError(detail);
        window.dispatchEvent(new CustomEvent("brief-desk-error", { detail }));
        return;
      }
      lastRunRef.current = { question, override };
      setRunError(null);
      const s = override?.source ?? source;
      const m = override?.mode ?? mode;
      const r = override?.repo !== undefined ? override.repo : repo;
      const rB = override?.repoB !== undefined ? override.repoB : repoB;
      const u = override?.url !== undefined ? override.url : url;
      const lang =
        override?.language !== undefined ? override.language : languageInput.trim() || null;
      const since = override?.since !== undefined ? override.since : sinceInput;
      const reg =
        override?.packageRegistry !== undefined ? override.packageRegistry : packageRegistry;
      const pkg =
        override?.packageName !== undefined
          ? override.packageName
            ? normalizePackageName(override.packageName, reg)
            : null
          : packageName;
      const tA = (override?.tagA !== undefined ? override.tagA : tagA)?.trim() || "";
      const tB = (override?.tagB !== undefined ? override.tagB : tagB)?.trim() || "";
      const g = (override?.goal !== undefined ? override.goal : question || goal)?.trim() || "";
      const sessionReady =
        (s === "auto" && g.length >= 8) ||
        (s === "github" && Boolean(r)) ||
        (s === "url" && Boolean(u)) ||
        (s === "compare" && Boolean(r) && Boolean(rB)) ||
        (s === "package" && Boolean(pkg)) ||
        (s === "releases" && Boolean(r) && Boolean(tA) && Boolean(tB) && tA !== tB) ||
        s === "corpus" ||
        s === "trending";
      if (!sessionReady) return;

      // Show the prompt in CopilotChat, then fill the reply via /api/brief-run
      // (reliable). followUp:false so we do not also fire the free-form agent.
      const userFacing = (s === "auto" || s === "trending" ? g || question : question).trim();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const planned = expectedSteps(s, hasBriefAuto, { packageRegistry: reg }).map((step, i) =>
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
            : s === "package"
              ? `${reg} package → draft → eval…`
              : s === "releases"
                ? "release diff → draft → eval…"
                : "orchestrate → draft → eval…",
      );
      emitPlan({ steps: planned, note: "Gathering…", active: true });

      try {
        await appendMessage(new TextMessage({ role: Role.User, content: userFacing }), {
          followUp: false,
        });

        const body = await runBriefViaApi(
          {
            source: s,
            mode: m,
            repo: r,
            repoB: rB,
            url: u,
            language: s === "trending" ? lang : undefined,
            since: s === "trending" ? since : undefined,
            packageName: s === "package" ? pkg : undefined,
            packageRegistry: s === "package" ? reg : undefined,
            tagA: s === "releases" ? tA : undefined,
            tagB: s === "releases" ? tB : undefined,
            question: s === "auto" || s === "trending" ? g || question : question,
            goal: s === "auto" || s === "trending" ? g || question : undefined,
          },
          {
            signal: controller.signal,
            onStep: (step, stepsSoFar) => {
              setBusyNote(`${stepsSoFar.join(" → ")}…`);
              const expected = expectedSteps(s, hasBriefAuto, { packageRegistry: reg });
              const done = new Set(stepsSoFar);
              emitPlan({
                active: true,
                note: step,
                steps: expected.map((row) => {
                  if (done.has(row.label) || stepsSoFar.some((x) => row.label.startsWith(x))) {
                    return { ...row, state: "done" as const };
                  }
                  if (row.label === step || row.label.includes(step)) {
                    return { ...row, state: "active" as const };
                  }
                  const idx = expected.findIndex((e) => e.id === row.id);
                  const activeIdx = expected.findIndex(
                    (e) => e.label === step || e.label.includes(step),
                  );
                  if (activeIdx >= 0 && idx < activeIdx) {
                    return { ...row, state: "done" as const };
                  }
                  if (activeIdx >= 0 && idx === activeIdx) {
                    return { ...row, state: "active" as const };
                  }
                  return row;
                }),
              });
            },
          },
        );
        if (
          controller.signal.aborted ||
          body.errorCategory === "cancelled" ||
          body.error?.startsWith(CANCELLED_MESSAGE)
        ) {
          throw new DOMException(CANCELLED_MESSAGE, "AbortError");
        }
        if (!body.ok || !body.answer) {
          throw new Error(body.error || "brief-run failed");
        }
        setRunError(null);
        if (body.runId) setLastRunId(body.runId);
        if (body.observability) setLastObservability(body.observability);
        if (Array.isArray(body.repos) && body.repos.length) {
          setTrendingSeed(body.repos);
        }
        const evalScore = evalOverallScore(body.eval);
        const score =
          evalScore != null
            ? `eval ${evalScore}`
            : body.eval &&
                typeof body.eval === "object" &&
                "pass" in body.eval &&
                (body.eval as { pass?: boolean }).pass === true
              ? "eval pass"
              : null;
        const meta = [`${(body.steps || []).join(" → ")}`, score, `${body.ms ?? "?"}ms`]
          .filter(Boolean)
          .join(" · ");
        const grounding = parseGrounding(body.eval);
        const evalView = parseEvalView(body.eval);
        setLastGrounding(grounding);
        setLastEvalView(evalView);
        const markdown =
          formatBriefMarkdown(body.answer, meta) +
          (grounding ? formatGroundingMarkdown(grounding) : "") +
          (evalView ? formatEvalMarkdown(evalView) : "");
        setLastMarkdown(markdown);
        skipNextChatHistory.current = true;
        setHistory((prev) =>
          pushBriefHistory(prev, {
            source: s,
            mode: s === "compare" ? "general" : m,
            label: historyLabel({
              source: s,
              repo: r,
              goal: g,
              question: userFacing,
              packageName: pkg,
              packageRegistry: reg,
              tagA: tA,
              tagB: tB,
            }),
            question: userFacing,
            answer: body.answer,
            markdown,
            meta,
            repo: r || undefined,
            repoB: rB || undefined,
            url: u || undefined,
            goal: s === "auto" || s === "trending" ? g || undefined : undefined,
            packageName: s === "package" ? pkg || undefined : undefined,
            packageRegistry: s === "package" ? reg : undefined,
            tagA: s === "releases" ? tA || undefined : undefined,
            tagB: s === "releases" ? tB || undefined : undefined,
            steps: body.steps,
            evalScore,
            ms: body.ms,
          }),
        );
        await appendMessage(new TextMessage({ role: Role.Assistant, content: markdown }), {
          followUp: false,
        });
        emitPlan({
          active: false,
          note: `${body.ms ?? "?"}ms${score ? ` · ${score}` : ""}`,
          steps: stepsFromNames(body.steps || ["done"]),
        });
        window.dispatchEvent(
          new CustomEvent("brief-desk-answer", {
            detail: {
              answer: body.answer,
              steps: body.steps,
              ms: body.ms,
              repos: body.repos,
              evalScore,
              grounding,
            },
          }),
        );
      } catch (e) {
        const aborted =
          controller.signal.aborted ||
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.message.startsWith(CANCELLED_MESSAGE));
        if (aborted) {
          setRunError(null);
          setLastGrounding(null);
          setLastEvalView(null);
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
        setRunError(message);
        setLastGrounding(null);
        setLastEvalView(null);
        setLastObservability((prev) =>
          prev
            ? { ...prev, errorCategory: prev.errorCategory || "unknown" }
            : prev,
        );
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
            content: `**Could not finish the brief.**\n\n${message}\n\nUse **Retry** to run the same brief again.`,
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
      packageName,
      packageRegistry,
      tagA,
      tagB,
      appendMessage,
    ],
  );

  const deepBriefFromTrending = useCallback(
    (repoName: string, kind: "overview" | "risks") => {
      setSource("github");
      setMode(kind);
      setRepoInput(repoName);
      const question =
        kind === "risks"
          ? "What are the biggest risks and open issues right now?"
          : "What are the main features and who is this for?";
      void runBrief(question, {
        source: "github",
        mode: kind,
        repo: repoName,
      });
    },
    [runBrief],
  );

  const openHistoryEntry = useCallback(
    (entry: BriefHistoryEntry) => {
      setSource(entry.source);
      setMode(entry.mode);
      if (entry.repo) setRepoInput(entry.repo);
      if (entry.repoB) setRepoBInput(entry.repoB);
      if (entry.url) setUrlInput(entry.url);
      if (entry.goal) setGoalInput(entry.goal);
      if (entry.packageRegistry) setPackageRegistry(entry.packageRegistry);
      if (entry.packageName) setPackageInput(entry.packageName);
      if (entry.tagA) setTagA(entry.tagA);
      if (entry.tagB) setTagB(entry.tagB);
      setLastMarkdown(entry.markdown);
      setLastGrounding(null);
      setLastEvalView(null);
      skipNextChatHistory.current = true;
      const { question } = chatMessagesFromHistory(entry);
      setPinned({
        id: entry.id,
        user: question,
        assistant: entry.markdown,
      });
    },
    [setPinned],
  );

  const copyMarkdown = useCallback(async (markdown: string) => {
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      // ignore
    }
  }, []);

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
              : source === "package"
                ? `${packageRegistry} · ${packageName || packageInput}`
                : source === "releases"
                  ? `${repo} · ${tagA}→${tagB}`
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
          packageName: source === "package" ? packageName || undefined : undefined,
          packageRegistry: source === "package" ? packageRegistry : undefined,
          tagA: source === "releases" ? tagA || undefined : undefined,
          tagB: source === "releases" ? tagB || undefined : undefined,
        },
        ...prev,
      ].slice(0, SAVED_MAX),
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
    if (demo.source === "package") {
      if (demo.packageRegistry) setPackageRegistry(demo.packageRegistry);
      if (demo.packageName) setPackageInput(demo.packageName);
    }
    if (demo.source === "releases") {
      setTagA(demo.tagA || "");
      setTagB(demo.tagB || "");
    }
  };

  const suggest =
    promptUi.suggest[source]?.length > 0
      ? promptUi.suggest[source]
      : FALLBACK_UI.suggest[source] ?? [];
  const modes = promptUi.modes?.length ? promptUi.modes : FALLBACK_UI.modes;
  const demos = promptUi.demos?.length ? promptUi.demos : FALLBACK_UI.demos;
  const defaultQ = { ...FALLBACK_UI.defaultQuestions, ...promptUi.defaultQuestions };

  const startQuestion =
    source === "auto"
      ? goal
      : source === "trending"
        ? suggest[0] ||
          `Rank trending ${languageInput || "any"} repos (${sinceInput}) for an engineering team.`
        : source === "package"
          ? suggest[0] || "Summarize latest version, license, and linked repo."
          : source === "releases"
            ? suggest[0] ||
              "Summarize breaking changes and notable features between these releases."
            : source === "compare"
              ? suggest[0] || "Compare these repositories."
              : source === "corpus"
                ? suggest[0] || "Summarize the sample docs."
                : source === "url"
                  ? suggest[0] || "Summarize this document for an engineer."
                  : defaultQ?.[mode] || "Give a concise engineering brief with citations.";

  return (
    <>
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
            <div className="header-actions">
              <AuthButton onUserChange={handleUserChange} />
              <ThemeToggle />
            </div>
          </div>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13, lineHeight: 1.4 }}>
            GitHub, docs, compare, trending, packages, release diffs, or corpus. Run agent drafts a
            brief with citations.
          </p>

          {mcpVersionWarn ? (
            <p className="mcp-warn" role="status">
              {mcpVersionWarn}
            </p>
          ) : null}
          {syncError ? (
            <p className="mcp-warn" role="status">
              Cloud sync: {syncError}
            </p>
          ) : null}

          <div className="brief-export-bar">
            <span className="brief-export-label">Session</span>
            <div className="brief-export-actions">
              <button
                type="button"
                className="chip history-action"
                onClick={() => void copySessionLink()}
              >
                {linkCopied ? "Link copied" : "Copy link"}
              </button>
            </div>
          </div>

          <BriefExportBar
            markdown={lastMarkdown}
            filename={`brief-${source}-${Date.now()}`}
          />

          <p className="section-label">Source</p>
          <div className="source-grid">
            {(
              [
                ["auto", "Auto"],
                ["trending", "Trending"],
                ["package", "Package"],
                ["releases", "Releases"],
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
              <TrendingPicker
                language={languageInput}
                since={sinceInput}
                seedRepos={trendingSeed}
                disabled={mcpBlocked || pipelineBusy || isLoading}
                onDeepBrief={deepBriefFromTrending}
              />
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

          {source === "package" ? (
            <>
              <p className="section-label">Registry</p>
              <select
                className="field field-select"
                value={packageRegistry}
                onChange={(e) => setPackageRegistry(e.target.value as PackageRegistry)}
                aria-label="Package registry"
              >
                {PACKAGE_REGISTRIES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="section-label">Package name</p>
              <input
                className="field"
                value={packageInput}
                onChange={(e) => setPackageInput(e.target.value)}
                placeholder={packageRegistry === "npm" ? "zod or @scope/name" : "httpx"}
                spellCheck={false}
                aria-label="Package name"
              />
            </>
          ) : null}

          {source !== "auto" &&
          source !== "compare" &&
          source !== "corpus" &&
          source !== "trending" &&
          source !== "package" &&
          source !== "releases" ? (
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

          {source === "github" ||
          source === "url" ||
          source === "compare" ||
          source === "releases" ? (
            <RepoCombobox
              label={
                source === "compare" ? "Repo A" : source === "releases" ? "GitHub repo" : "GitHub repo"
              }
              value={repoInput}
              onChange={(v) => {
                setRepoInput(v);
                if (source === "releases") {
                  setTagA("");
                  setTagB("");
                }
              }}
              savedRepos={saved
                .map((s) => s.repo)
                .filter((r): r is string => Boolean(r))}
            />
          ) : null}

          {source === "releases" ? (
            <ReleaseDiffPanel
              repo={repo}
              tagA={tagA}
              tagB={tagB}
              onTagA={setTagA}
              onTagB={setTagB}
              disabled={mcpBlocked || pipelineBusy || isLoading}
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
                  : source === "package"
                    ? "Brief package"
                    : source === "releases"
                      ? "Diff releases"
                      : "Start brief"}
          </button>

          {canCancel ? (
            <button type="button" className="btn-danger" onClick={cancelRun}>
              Cancel run
            </button>
          ) : null}

          {runError && !pipelineBusy && !isLoading ? (
            <div className="run-error-bar" role="alert">
              <p className="run-error-text">{runError}</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const last = lastRunRef.current;
                  if (!last) {
                    void runBrief(startQuestion, source === "auto" ? { goal } : undefined);
                    return;
                  }
                  void runBrief(last.question, last.override);
                }}
              >
                Retry
              </button>
            </div>
          ) : null}

          <PlanBoard />

          <BriefRunStatus
            runId={lastRunId}
            observability={lastObservability}
            busyNote={busyNote}
            pipelineBusy={pipelineBusy}
          />
          <BriefGroundingPanel grounding={lastGrounding} />
          <BriefEvalPanel evalView={lastEvalView} />

          <button
            type="button"
            className="btn-secondary"
            onClick={pinSession}
            disabled={!ready}
          >
            Save session shortcut
          </button>

          <BriefHistory
            entries={history}
            onOpen={openHistoryEntry}
            onClear={() => {
              setHistory([]);
              saveBriefHistory([]);
              if (cloudUserId) void clearRemoteHistory();
            }}
            onCopy={(md) => void copyMarkdown(md)}
          />

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
                    packageName: d.packageName || null,
                    packageRegistry: d.packageRegistry,
                    tagA: d.tagA || null,
                    tagB: d.tagB || null,
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
                      if (s.packageRegistry) setPackageRegistry(s.packageRegistry);
                      if (s.packageName) setPackageInput(s.packageName);
                      if (s.tagA) setTagA(s.tagA);
                      if (s.tagB) setTagB(s.tagB);
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
                // Empty: History restore is rendered by LoggingMessages via pinned
                // thread. A changing `initial` string used to wipe the chat.
                initial: "",
              }}
              className="h-full"
              Messages={LoggingMessages}
            />
          </div>
        </section>
        <AgentLog />
      </main>
    </>
  );
}
