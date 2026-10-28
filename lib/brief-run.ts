import {
  CANCELLED_MESSAGE,
  TIMEOUT_MESSAGE,
  isAbortError,
  throwIfAborted,
  withTimeout,
} from "./abort";
import { callMcpTool } from "./mcp-client";
import { fetchGithubTrending, isMcpToolMissing } from "./github-trending";
import {
  actionableErrorMessage,
  categorizeError,
  logRunEvent,
  newRunId,
  type ModelUsage,
  type RunObservability,
  type ToolTiming,
} from "./run-observability";

export type BriefRunInput = {
  source:
    | "auto"
    | "github"
    | "url"
    | "compare"
    | "corpus"
    | "trending"
    | "package"
    | "releases";
  mode?: string;
  repo?: string | null;
  repoB?: string | null;
  url?: string | null;
  language?: string | null;
  since?: string | null;
  packageName?: string | null;
  packageRegistry?: "npm" | "pypi" | null;
  tagA?: string | null;
  tagB?: string | null;
  question: string;
  goal?: string | null;
};

export type BriefRunRepoHit = {
  repo: string;
  description?: string | null;
  stars_delta?: string | null;
  stars_period?: string | null;
  language?: string | null;
  url?: string;
};

export type BriefRunResult = {
  ok: boolean;
  answer: string;
  steps: string[];
  eval?: unknown;
  error?: string;
  /** Stable id for logs / support. */
  runId?: string;
  errorCategory?: RunObservability["errorCategory"];
  observability?: RunObservability;
  ms: number;
  /** Structured hits when source was trending (or auto invent trending). */
  repos?: BriefRunRepoHit[];
};

function extractReposFromEvidence(evidence: string): BriefRunRepoHit[] {
  try {
    const parsed = JSON.parse(evidence) as {
      repos?: BriefRunRepoHit[];
      gather?: { trending?: { repos?: BriefRunRepoHit[] }; search?: { repos?: Array<{ repo?: string; description?: string | null }> } };
    };
    if (Array.isArray(parsed.repos)) {
      return parsed.repos.filter((r) => typeof r.repo === "string" && r.repo.includes("/"));
    }
    const fromTrend = parsed.gather?.trending?.repos;
    if (Array.isArray(fromTrend)) {
      return fromTrend.filter((r) => typeof r.repo === "string" && r.repo.includes("/"));
    }
    const fromSearch = parsed.gather?.search?.repos;
    if (Array.isArray(fromSearch)) {
      return fromSearch
        .filter((r) => typeof r.repo === "string" && r.repo.includes("/"))
        .map((r) => ({
          repo: r.repo as string,
          description: r.description ?? null,
        }));
    }
  } catch {
    // not JSON
  }
  return [];
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n…[truncated]`;
}

const MODEL_ALIASES: Record<string, string> = {
  "llama-3.3-70b-versatile": "qwen/qwen3.8-27b",
  "llama-3.1-8b-instant": "qwen/qwen3.8-27b",
  "llama-3.1-70b-versatile": "qwen/qwen3.8-27b",
  "gpt-oss-20b": "openai/gpt-oss-20b",
  "gpt-oss-120b": "openai/gpt-oss-120b",
  "qwen3.8-27b": "qwen/qwen3.8-27b",
};

function resolveModelId(): string {
  // Prefer BRIEF_RUN_MODEL. Ignore stale Llama ids still set on some hosts.
  const raw =
    process.env.BRIEF_RUN_MODEL?.trim() ||
    process.env.COPILOTKIT_AGENT_MODEL?.trim() ||
    "openai:qwen/qwen3.8-27b";
  const id = raw.replace(/^openai[:/]/i, "");
  return MODEL_ALIASES[id] ?? id;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("brief-run cancelled", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type McpCall = Awaited<ReturnType<typeof callMcpTool>>;

type ObsState = {
  runId: string;
  toolTimings: ToolTiming[];
  modelUsage: ModelUsage;
};

async function mcp(
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  obs: ObsState,
): Promise<McpCall> {
  throwIfAborted(signal);
  const result = await callMcpTool(name, args, { signal });
  obs.toolTimings.push({
    tool: name,
    ms: result.ms,
    ok: result.ok,
    error: result.error,
  });
  logRunEvent("mcp_tool", {
    runId: obs.runId,
    tool: name,
    ms: result.ms,
    ok: result.ok,
    cancelled: result.cancelled,
    timedOut: result.timedOut,
    error: result.error ? result.error.slice(0, 160) : undefined,
  });
  if (result.cancelled) {
    throw new DOMException("brief-run cancelled", "AbortError");
  }
  if (result.timedOut) {
    throw new Error(result.error || TIMEOUT_MESSAGE);
  }
  return result;
}

async function draftWithGroq(
  question: string,
  evidence: string,
  signal: AbortSignal | undefined,
  obs: ObsState,
): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  const base = process.env.OPENAI_BASE_URL || "https://api.groq.com/openai/v1";
  const model = resolveModelId();
  if (!key) throw new Error("OPENAI_API_KEY missing for brief-run draft");

  const userContent = `Question:\n${question}\n\nEvidence pack (JSON/text):\n${truncate(evidence, 8000)}\n\nWrite the final brief now.`;
  const payload = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You write concise engineering briefs from evidence only. Cite paths, #issue/#PR, or URLs. Start with one line: Plan: <source> · <mode> · <targets>. No tool calls. No preamble.",
      },
      {
        role: "user",
        content: userContent,
      },
    ],
    // Keep OTPM headroom on Groq free tier.
    max_tokens: 550,
    temperature: 0.2,
  };

  let lastErr = "draft failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    throwIfAborted(signal);
    const t0 = Date.now();
    const { signal: attemptSignal, clear } = withTimeout(45_000, signal);
    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: attemptSignal,
      });
    } finally {
      clear();
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    const ms = Date.now() - t0;
    obs.modelUsage.calls += 1;
    obs.modelUsage.model = model;
    obs.modelUsage.promptChars += userContent.length;
    obs.modelUsage.ms += ms;
    if (res.ok) {
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("draft model returned empty content");
      obs.modelUsage.completionChars += content.length;
      logRunEvent("model_draft", {
        runId: obs.runId,
        model,
        ms,
        ok: true,
        attempt,
        completionChars: content.length,
      });
      return content;
    }
    lastErr = body.error?.message || `draft failed (${res.status})`;
    logRunEvent("model_draft", {
      runId: obs.runId,
      model,
      ms,
      ok: false,
      attempt,
      error: lastErr.slice(0, 160),
    });
    const retryable = res.status === 429 || /rate limit|try again/i.test(lastErr);
    if (!retryable || attempt === 3) break;
    throwIfAborted(signal);
    const waitMatch = /try again in ([\d.]+)s/i.exec(lastErr);
    const waitMs = waitMatch
      ? Math.min(45_000, Math.ceil(Number(waitMatch[1]) * 1000) + 500)
      : 8_000 * (attempt + 1);
    await sleep(waitMs, signal);
  }
  throwIfAborted(signal);
  throw new Error(lastErr);
}

export type BriefRunOptions = {
  onStep?: (step: string, stepsSoFar: string[]) => void;
  /** Propagates cancel / client disconnect through MCP and model calls. */
  signal?: AbortSignal;
};

function pushStep(
  steps: string[],
  name: string,
  onStep?: BriefRunOptions["onStep"],
): void {
  steps.push(name);
  onStep?.(name, [...steps]);
}

/** Deterministic gather → draft → eval path (no multi-step agent loop). */
export async function runBriefPipeline(
  input: BriefRunInput,
  opts?: BriefRunOptions,
): Promise<BriefRunResult> {
  const t0 = Date.now();
  const steps: string[] = [];
  const onStep = opts?.onStep;
  const signal = opts?.signal;
  const runId = newRunId();
  const obs: ObsState = {
    runId,
    toolTimings: [],
    modelUsage: { model: resolveModelId(), calls: 0, promptChars: 0, completionChars: 0, ms: 0 },
  };
  const question = (input.goal || input.question).trim();
  if (question.length < 4) {
    return { ok: false, answer: "", steps, error: "question/goal required", runId, ms: 0 };
  }
  logRunEvent("brief_run_start", { runId, source: input.source });

  let evidence = "";
  try {
    throwIfAborted(signal);

    if (input.source === "auto") {
      pushStep(steps, "brief_auto", onStep);
      const auto = await mcp("brief_auto", { goal: question }, signal, obs);
      if (!auto.ok) {
        pushStep(steps, "brief_plan", onStep);
        const plan = await mcp("brief_plan", { goal: question }, signal, obs);
        if (!plan.ok) {
          return {
            ok: false,
            answer: "",
            steps,
            error: auto.error || plan.error || "auto gather failed",
            runId,
            ms: Date.now() - t0,
          };
        }
        let invented: {
          repo?: string | null;
          repo_b?: string | null;
          url?: string | null;
          mode?: string;
        } = {};
        try {
          invented = (JSON.parse(plan.text) as { invented?: typeof invented }).invented || {};
        } catch {
          invented = {};
        }
        pushStep(steps, "brief_orchestrate", onStep);
        const orch = await mcp(
          "brief_orchestrate",
          {
            question,
            repo: invented.repo || undefined,
            repo_b: invented.repo_b || undefined,
            url: invented.url || undefined,
            mode: invented.mode || undefined,
          },
          signal,
          obs,
        );
        if (!orch.ok) {
          return {
            ok: false,
            answer: "",
            steps,
            error: orch.error || "orchestrate failed",
            runId,
            ms: Date.now() - t0,
          };
        }
        evidence = `${plan.text}\n\n${orch.text}`;
      } else {
        evidence = auto.text;
      }
    } else if (input.source === "corpus") {
      pushStep(steps, "brief_corpus", onStep);
      const corpus = await mcp("brief_corpus", { question }, signal, obs);
      if (!corpus.ok) {
        return {
          ok: false,
          answer: "",
          steps,
          error: corpus.error || "corpus failed",
          ms: Date.now() - t0,
        };
      }
      evidence = corpus.text;
    } else if (input.source === "trending") {
      pushStep(steps, "brief_github_trending", onStep);
      const trend = await mcp(
        "brief_github_trending",
        {
          language: input.language || undefined,
          since: input.since || "weekly",
          max_results: 10,
        },
        signal,
        obs,
      );
      if (trend.ok) {
        evidence = trend.text;
      } else if (isMcpToolMissing(trend.error) || trend.error) {
        pushStep(steps, "github_trending_direct", onStep);
        throwIfAborted(signal);
        const scraped = await fetchGithubTrending({
          language: input.language,
          since: input.since || "weekly",
          maxResults: 10,
          signal,
        });
        if (!scraped.repos.length) {
          return {
            ok: false,
            answer: "",
            steps,
            error: scraped.error || trend.error || "trending failed",
            runId,
            ms: Date.now() - t0,
          };
        }
        evidence = JSON.stringify(scraped);
      } else {
        return {
          ok: false,
          answer: "",
          steps,
          error: trend.error || "trending failed",
          ms: Date.now() - t0,
        };
      }
    } else if (input.source === "package") {
      const registry = input.packageRegistry === "pypi" ? "pypi" : "npm";
      const name = (input.packageName || "").trim();
      if (!name) {
        return {
          ok: false,
          answer: "",
          steps,
          error: "package name required",
          ms: Date.now() - t0,
        };
      }
      const tool = registry === "pypi" ? "brief_pypi_package" : "brief_npm_package";
      pushStep(steps, tool, onStep);
      const pkg = await mcp(tool, { name }, signal, obs);
      if (!pkg.ok) {
        return {
          ok: false,
          answer: "",
          steps,
          error: pkg.error || "package lookup failed",
          ms: Date.now() - t0,
        };
      }
      evidence = pkg.text;
    } else if (input.source === "releases") {
      const r = (input.repo || "").trim();
      const a = (input.tagA || "").trim();
      const b = (input.tagB || "").trim();
      if (!r || !a || !b) {
        return {
          ok: false,
          answer: "",
          steps,
          error: "repo, tagA, and tagB are required",
          ms: Date.now() - t0,
        };
      }
      if (a === b) {
        return {
          ok: false,
          answer: "",
          steps,
          error: "pick two different release tags",
          ms: Date.now() - t0,
        };
      }
      pushStep(steps, "brief_repo_release_diff", onStep);
      const diff = await mcp(
        "brief_repo_release_diff",
        {
          repo: r,
          tag_a: a,
          tag_b: b,
        },
        signal,
        obs,
      );
      if (!diff.ok) {
        return {
          ok: false,
          answer: "",
          steps,
          error: diff.error || "release diff failed",
          ms: Date.now() - t0,
        };
      }
      evidence = diff.text;
    } else {
      pushStep(steps, "brief_orchestrate", onStep);
      const orch = await mcp(
        "brief_orchestrate",
        {
          question,
          repo: input.repo || undefined,
          repo_b: input.repoB || undefined,
          url: input.url || undefined,
          mode: input.source === "compare" ? "compare" : input.mode || undefined,
        },
        signal,
        obs,
      );
      if (!orch.ok) {
        return {
          ok: false,
          answer: "",
          steps,
          error: orch.error || "orchestrate failed",
          ms: Date.now() - t0,
        };
      }
      evidence = orch.text;
    }

    throwIfAborted(signal);
    pushStep(steps, "draft", onStep);
    let draft = await draftWithGroq(question, evidence, signal, obs);

    throwIfAborted(signal);
    pushStep(steps, "brief_eval", onStep);
    const ev = await mcp(
      "brief_eval",
      {
        question,
        draft,
        evidence: truncate(evidence, 1200),
      },
      signal,
      obs,
    );
    let evalObj: unknown = ev.text;
    try {
      evalObj = JSON.parse(ev.text);
    } catch {
      // keep string
    }
    const pass =
      typeof evalObj === "object" &&
      evalObj &&
      "pass" in evalObj &&
      (evalObj as { pass?: boolean }).pass === true;

    if (!pass) {
      throwIfAborted(signal);
      pushStep(steps, "revise", onStep);
      draft = await draftWithGroq(
        `${question}\n\nRevise this draft using the evidence. Keep citations that appear in the evidence pack.\n\nDraft:\n${draft}`,
        evidence,
        signal,
        obs,
      );
      throwIfAborted(signal);
      pushStep(steps, "brief_eval", onStep);
      const ev2 = await mcp(
        "brief_eval",
        {
          question,
          draft,
          evidence: truncate(evidence, 1200),
        },
        signal,
        obs,
      );
      try {
        evalObj = JSON.parse(ev2.text);
      } catch {
        evalObj = ev2.text;
      }
    }

    const repos = extractReposFromEvidence(evidence);
    const observability: RunObservability = {
      runId,
      toolTimings: obs.toolTimings,
      modelUsage: obs.modelUsage.calls ? obs.modelUsage : null,
    };
    logRunEvent("brief_run_ok", {
      runId,
      ms: Date.now() - t0,
      steps,
      tools: obs.toolTimings.length,
      modelCalls: obs.modelUsage.calls,
    });
    return {
      ok: true,
      answer: draft,
      steps,
      eval: evalObj,
      runId,
      observability,
      ms: Date.now() - t0,
      ...(repos.length ? { repos } : {}),
    };
  } catch (e) {
    const raw = isAbortError(e)
      ? CANCELLED_MESSAGE
      : e instanceof Error
        ? e.message
        : "brief-run failed";
    const errorCategory = categorizeError(raw);
    const error = actionableErrorMessage(errorCategory, raw, runId);
    const observability: RunObservability = {
      runId,
      toolTimings: obs.toolTimings,
      modelUsage: obs.modelUsage.calls ? obs.modelUsage : null,
      errorCategory,
    };
    logRunEvent("brief_run_error", {
      runId,
      ms: Date.now() - t0,
      errorCategory,
      error: raw.slice(0, 200),
      steps,
    });
    return {
      ok: false,
      answer: "",
      steps,
      error,
      runId,
      errorCategory,
      observability,
      ms: Date.now() - t0,
    };
  }
}

export function evalOverallScore(evalObj: unknown): number | null {
  if (!evalObj || typeof evalObj !== "object") return null;
  const scores = (evalObj as { scores?: { overall?: unknown } }).scores;
  return typeof scores?.overall === "number" ? scores.overall : null;
}
