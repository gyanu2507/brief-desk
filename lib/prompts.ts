import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderTemplate } from "./template";

export { renderTemplate } from "./template";

const PROMPTS_ROOT = path.join(process.cwd(), "prompts");

export type SourceKind = "auto" | "github" | "url" | "compare" | "corpus";
export type BriefMode =
  | "overview"
  | "risks"
  | "architecture"
  | "activity"
  | "code"
  | "docs"
  | "general";

export type PromptUi = {
  readableDescription: string;
  modes: { id: BriefMode; label: string }[];
  defaultQuestions: Record<BriefMode, string>;
  suggest: Record<SourceKind, string[]>;
  sessionNotes: Record<string, string>;
  demos: {
    label: string;
    source: SourceKind;
    mode: BriefMode;
    repo?: string;
    repoB?: string;
    url?: string;
    goal?: string;
    question: string;
  }[];
};

function readPrompt(rel: string): string {
  return readFileSync(path.join(PROMPTS_ROOT, rel), "utf8").trim();
}

/** System + router + every route file. Edit prompts/ to change agent behavior. */
export function loadAgentSystemPrompt(): string {
  const system = readPrompt("system.md");
  const router = readPrompt("router.md");
  const routeDir = path.join(PROMPTS_ROOT, "routes");
  const routeFiles = readdirSync(routeDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const routes = routeFiles.map((f) => readPrompt(path.join("routes", f))).join("\n\n");
  return [system, router, routes].join("\n\n");
}

export function loadUiConfig(): PromptUi {
  return JSON.parse(readPrompt("ui.json")) as PromptUi;
}

export function loadStartBriefTemplate(): string {
  return readPrompt("templates/start-brief.md");
}

export function loadAutoBriefTemplate(): string {
  return readPrompt("templates/auto-brief.md");
}

export function renderStartBrief(args: {
  source: SourceKind;
  mode: BriefMode | "compare";
  repo?: string | null;
  repoB?: string | null;
  url?: string | null;
  question: string;
  goal?: string | null;
}): string {
  if (args.source === "auto") {
    const hintBits = [
      args.repo ? `hint_repo=${args.repo}` : null,
      args.repoB ? `hint_repo_b=${args.repoB}` : null,
      args.url ? `hint_url=${args.url}` : null,
    ].filter(Boolean);
    return renderTemplate(loadAutoBriefTemplate(), {
      goal: (args.goal || args.question).trim(),
      hints: hintBits.length ? hintBits.join("\n") : "",
    });
  }
  const mode = args.source === "compare" ? "compare" : args.mode;
  return renderTemplate(loadStartBriefTemplate(), {
    source: args.source,
    mode,
    repo_line: args.repo ? `repo=${args.repo}` : "",
    repo_b_line: args.repoB ? `repo_b=${args.repoB}` : "",
    url_line: args.url ? `url=${args.url}` : "",
    question: args.question,
  });
}

export function renderSessionNote(args: {
  source: SourceKind;
  mode: BriefMode;
  repo?: string | null;
  repoB?: string | null;
  url?: string | null;
}): string {
  const ui = loadUiConfig();
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

export function getPromptsBundle() {
  return {
    agentPromptPreview: loadAgentSystemPrompt().slice(0, 240) + "…",
    startBriefTemplate: loadStartBriefTemplate(),
    autoBriefTemplate: loadAutoBriefTemplate(),
    ui: loadUiConfig(),
    routes: readdirSync(path.join(PROMPTS_ROOT, "routes"))
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => f.replace(/\.md$/, "")),
  };
}
