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

function resolveModelId(): string {
  const raw =
    process.env.BRIEF_RUN_MODEL?.trim() ||
    process.env.COPILOTKIT_AGENT_MODEL?.trim() ||
    "openai:qwen/qwen3.8-27b";
  return raw.replace(/^openai[:/]/i, "");
}

async function draftWithGroq(question: string, evidence: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  const base = process.env.OPENAI_BASE_URL || "https://api.groq.com/openai/v1";
  const model = resolveModelId();
  if (!key) throw new Error("OPENAI_API_KEY missing for brief-run draft");

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You write concise engineering briefs from evidence only. Cite paths, #issue/#PR, or URLs. Start with one line: Plan: <source> · <mode> · <targets>. No tool calls. No preamble.",
        },
        {
          role: "user",
          content: `Question:\n${question}\n\nEvidence pack (JSON/text):\n${truncate(evidence, 10000)}\n\nWrite the final brief now.`,
        },
      ],
      max_tokens: 900,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body.error?.message || `draft failed (${res.status})`);
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("draft model returned empty content");
  return content;
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
