const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type BriefMode =
  | "overview"
  | "risks"
  | "architecture"
  | "activity"
  | "code"
  | "docs"
  | "compare"
  | "general";

export function normalizeGithubRepo(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  return REPO_RE.test(trimmed) ? trimmed : undefined;
}

export function classifyBriefMode(question: string): BriefMode {
  const q = question.toLowerCase();
  if (/\b(compar|vs\.?|versus|diff(erence)? between)\b/.test(q)) return "compare";
  if (/\b(risks?|security|vulnerab|cve|threat|incident)\b/.test(q)) return "risks";
  if (/\b(architect|design|structure|module|component|how is it (built|organized))\b/.test(q)) {
    return "architecture";
  }
  if (/\b(issue|pr|pull request|landed|merged|changelog|release|activity)\b/.test(q)) return "activity";
  if (/\b(how does|where is|implement|code|source|function|api|endpoint)\b/.test(q)) return "code";
  if (/\b(doc|docs|documentation|guide|tutorial|readme|corpus)\b/.test(q)) return "docs";
  if (/\b(feature|overview|what is|what does|getting started|about)\b/.test(q)) return "overview";
  return "general";
}

export function planForMode(mode: BriefMode, hasRepo: boolean, hasUrl: boolean): string[] {
  const steps: string[] = [`plan:${mode}`];
  if (mode === "compare") {
    steps.push("gather:meta+readme for each repo", "synthesize:side-by-side", "eval:citations");
    return steps;
  }
  if (hasUrl) steps.push("gather:public_url");
  if (hasRepo) {
    if (mode === "overview") steps.push("gather:overview", "optional:root");
    else if (mode === "activity" || mode === "risks") {
      steps.push("gather:issues+releases", "optional:workspace");
    } else if (mode === "architecture") steps.push("gather:overview+root", "optional:code");
    else if (mode === "code") steps.push("gather:ask(code)", "optional:file");
    else if (mode === "docs") steps.push(hasUrl ? "gather:url" : "gather:overview+corpus");
    else steps.push("gather:ask(mixed)");
  } else if (!hasUrl) {
    steps.push("gather:corpus_or_ask_for_repo_or_url");
  }
  steps.push("draft:answer_from_evidence", "eval:rubric");
  return steps;
}

/** Infer repos/URLs/mode/source from a free-form goal so the agent can plan without a filled panel. */
export function buildAutonomousPlan(goal: string): Record<string, unknown> {
  const urls = [...goal.matchAll(/https?:\/\/[^\s)>\]]+/gi)]
    .map((m) => m[0].replace(/[.,;]+$/, ""))
    .filter((u) => {
      try {
        const p = new URL(u);
        return p.protocol === "http:" || p.protocol === "https:";
      } catch {
        return false;
      }
    });
  const fromLinks = urls
    .map((u) => {
      const m = u.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
      return m ? normalizeGithubRepo(m[1]) : undefined;
    })
    .filter((r): r is string => Boolean(r));
  const fromSlash = [...goal.matchAll(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/g)]
    .map((m) => normalizeGithubRepo(m[1]))
    .filter((r): r is string => Boolean(r))
    // Drop path-looking matches that are already inside a captured URL (e.g. docs hosts).
    .filter((r) => !urls.some((u) => u.includes(r)))
    .filter((r) => !r.split("/")[0]?.includes("."));
  const repos = [...new Set([...fromLinks, ...fromSlash])];
  const docsUrls = urls.filter((u) => !/github\.com\//i.test(u));
  const mode = classifyBriefMode(goal);
  let source_kind: "github" | "url" | "compare" | "corpus" | "auto" = "auto";
  if (mode === "compare" && repos.length >= 2) source_kind = "compare";
  else if (docsUrls.length && !repos.length) source_kind = "url";
  else if (repos.length) source_kind = "github";
  else if (docsUrls.length) source_kind = "url";
  else if (/\b(corpus|sample docs|bundled)\b/i.test(goal)) source_kind = "corpus";

  const subgoals: string[] = [];
  if (source_kind === "compare" || (mode === "compare" && repos.length >= 2)) {
    subgoals.push(`Compare ${repos[0]} vs ${repos[1]} on purpose, stack, maturity`);
    subgoals.push("Call out when to pick which");
  } else if (mode === "risks") {
    subgoals.push("Surface open issues / security signals");
    subgoals.push("Rank top risks with citations");
  } else if (mode === "architecture") {
    subgoals.push("Map modules and entry points");
    subgoals.push("Explain how the core flow fits together");
  } else if (docsUrls.length) {
    subgoals.push("Extract engineer-relevant concepts from the URL");
    subgoals.push("List actionable next steps");
  } else if (source_kind === "corpus") {
    subgoals.push("Search the bundled corpus");
    subgoals.push("Answer only from local hits");
  } else {
    subgoals.push("Produce a concise engineering brief");
    subgoals.push("Cite paths, issues, or URLs from evidence");
  }

  const tool_steps: string[] = ["brief_plan (done)"];
  if (source_kind === "corpus") {
    tool_steps.push("brief_corpus", "draft", "brief_eval", "revise if pass=false");
  } else if (repos.length || docsUrls.length) {
    tool_steps.push(
      "brief_orchestrate with inferred fields",
      "optional: brief_repo_file / brief_fetch_url for gaps",
      "draft from gather only",
      "brief_eval",
      "revise once if pass=false",
    );
  } else {
    tool_steps.push(
      "ask user for owner/name or public URL if goal is too vague",
      "or brief_corpus if they meant the sample",
    );
  }

  return {
    goal,
    invented: {
      source_kind,
      mode,
      repo: repos[0] ?? null,
      repo_b: repos[1] ?? null,
      url: docsUrls[0] ?? null,
      subgoals,
    },
    tool_steps,
    success: [
      "Answer grounded in tool evidence",
      "Citations present (paths, #issue/#PR, or URLs)",
      "brief_eval pass=true (or one revision applied)",
    ],
    next:
      repos.length || docsUrls.length || source_kind === "corpus"
        ? "Execute tool_steps now. Do not wait for the user to fill the left panel."
        : "Goal has no extractable repo/URL. Ask one clarifying question or use brief_corpus.",
  };
}
