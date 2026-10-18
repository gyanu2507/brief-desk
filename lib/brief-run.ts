import { callMcpTool } from "./mcp-client";

export type BriefRunInput = {
  source: "auto" | "github" | "url" | "compare" | "corpus";
  mode?: string;
  repo?: string | null;
  repoB?: string | null;
  url?: string | null;
  question: string;
  goal?: string | null;
};

export type BriefRunResult = {
  ok: boolean;
  answer: string;
  steps: string[];
  eval?: unknown;
  error?: string;
  ms: number;
};

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function draftWithGroq(question: string, evidence: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  const base = process.env.OPENAI_BASE_URL || "https://api.groq.com/openai/v1";
  const model = resolveModelId();
  if (!key) throw new Error("OPENAI_API_KEY missing for brief-run draft");

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
        content: `Question:\n${question}\n\nEvidence pack (JSON/text):\n${truncate(evidence, 8000)}\n\nWrite the final brief now.`,
      },
    ],
    // Keep OTPM headroom on Groq free tier.
    max_tokens: 550,
    temperature: 0.2,
  };

  let lastErr = "draft failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    });
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (res.ok) {
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("draft model returned empty content");
      return content;
    }
    lastErr = body.error?.message || `draft failed (${res.status})`;
    const retryable = res.status === 429 || /rate limit|try again/i.test(lastErr);
    if (!retryable || attempt === 3) break;
    const waitMatch = /try again in ([\d.]+)s/i.exec(lastErr);
    const waitMs = waitMatch
      ? Math.min(45_000, Math.ceil(Number(waitMatch[1]) * 1000) + 500)
      : 8_000 * (attempt + 1);
    await sleep(waitMs);
  }
  throw new Error(lastErr);
}

/** Deterministic gather → draft → eval path (no multi-step agent loop). */
export async function runBriefPipeline(input: BriefRunInput): Promise<BriefRunResult> {
  const t0 = Date.now();
  const steps: string[] = [];
  const question = (input.goal || input.question).trim();
  if (question.length < 4) {
    return { ok: false, answer: "", steps, error: "question/goal required", ms: 0 };
  }

  let evidence = "";
  try {
    if (input.source === "auto") {
      steps.push("brief_auto");
      const auto = await callMcpTool("brief_auto", { goal: question });
      if (!auto.ok) {
        steps.push("brief_plan");
        const plan = await callMcpTool("brief_plan", { goal: question });
        if (!plan.ok) {
          return {
            ok: false,
            answer: "",
            steps,
            error: auto.error || plan.error || "auto gather failed",
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
        steps.push("brief_orchestrate");
        const orch = await callMcpTool("brief_orchestrate", {
          question,
          repo: invented.repo || undefined,
          repo_b: invented.repo_b || undefined,
          url: invented.url || undefined,
          mode: invented.mode || undefined,
        });
        if (!orch.ok) {
          return {
            ok: false,
            answer: "",
            steps,
            error: orch.error || "orchestrate failed",
            ms: Date.now() - t0,
          };
        }
        evidence = `${plan.text}\n\n${orch.text}`;
      } else {
        evidence = auto.text;
      }
    } else if (input.source === "corpus") {
      steps.push("brief_corpus");
      const corpus = await callMcpTool("brief_corpus", { question });
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
    } else {
      steps.push("brief_orchestrate");
      const orch = await callMcpTool("brief_orchestrate", {
        question,
        repo: input.repo || undefined,
        repo_b: input.repoB || undefined,
        url: input.url || undefined,
        mode: input.source === "compare" ? "compare" : input.mode || undefined,
      });
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

    steps.push("draft");
    let draft = await draftWithGroq(question, evidence);

    steps.push("brief_eval");
    const ev = await callMcpTool("brief_eval", {
      question,
      draft,
      evidence: truncate(evidence, 1200),
    });
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
      steps.push("revise");
      draft = await draftWithGroq(
        `${question}\n\nRevise this draft using the evidence. Keep citations.\n\nDraft:\n${draft}`,
        evidence,
      );
    }

    return {
      ok: true,
      answer: draft,
      steps,
      eval: evalObj,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      answer: "",
      steps,
      error: e instanceof Error ? e.message : "brief-run failed",
      ms: Date.now() - t0,
    };
  }
}
