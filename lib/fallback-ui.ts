import type { BriefMode, PromptUi, SourceKind } from "./types";

/** Client-safe defaults so demos/queries work even if /api/prompts is slow. */
export const FALLBACK_UI: PromptUi = {
  readableDescription:
    "Active brief-desk session. Prefer brief_auto (or plan+orchestrate/trending/search), then draft + brief_eval.",
  modes: [
    { id: "overview", label: "Overview" },
    { id: "risks", label: "Risks" },
    { id: "architecture", label: "Architecture" },
    { id: "activity", label: "Activity" },
    { id: "code", label: "Code" },
    { id: "docs", label: "Docs" },
    { id: "general", label: "General" },
  ],
  defaultQuestions: {
    overview: "What are the main features and who is this for?",
    risks: "What are the biggest risks and open issues right now?",
    architecture: "How is the project structured and what are the main modules?",
    activity: "What has landed recently in issues, PRs, and releases?",
    code: "Where should I start reading the code for the core flow?",
    docs: "Summarize the docs a new engineer needs first.",
    general: "Give a concise engineering brief with citations.",
  },
  suggest: {
    auto: [
      "Brief facebook/react risks for an eng manager.",
      "What TypeScript repos are trending on GitHub this week?",
      "Find React form libraries with strong TypeScript support.",
      "Brief the npm package zod for an engineer picking a schema lib.",
      "Brief the pypi package httpx for an async HTTP client choice.",
    ],
    github: [
      "What are the main features?",
      "What are the biggest risks right now?",
      "How is the project structured?",
      "What shipped in the latest releases?",
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
    trending: [
      "Rank this week's trending TypeScript repos for a frontend team.",
      "Which trending repos look production-ready vs experimental?",
      "Shortlist 5 picks and why an eng manager should care.",
    ],
  },
  sessionNotes: {
    auto: "Call brief_auto once (or brief_plan + gather tools). Draft + brief_eval.",
    github_ready: "Use brief_orchestrate with repo={{repo}} and mode={{mode}}, then brief_eval.",
    github_missing: "Ask user for owner/name or switch to Auto.",
    url_ready: "Use brief_orchestrate with url={{url}}{{repo_suffix}}, mode={{mode}}, then brief_eval.",
    url_missing: "Ask user for a public https URL or switch to Auto.",
    compare_ready: "Use brief_orchestrate mode=compare repo={{repo}} repo_b={{repo_b}}, then brief_eval.",
    compare_missing: "Need two owner/name values, or use Auto with both in the goal.",
    corpus: "Use brief_corpus once, then brief_eval.",
    trending: "Use brief_github_trending (language/since), draft shortlist, then brief_eval.",
  },
  demos: [
    {
      label: "Auto · React risks",
      source: "auto" as SourceKind,
      mode: "general" as BriefMode,
      goal: "Brief facebook/react risks for an eng manager.",
      question: "Brief facebook/react risks for an eng manager.",
    },
    {
      label: "Trending · TypeScript week",
      source: "trending" as SourceKind,
      mode: "general" as BriefMode,
      goal: "Rank this week's trending TypeScript repos for a frontend team.",
      question: "Rank this week's trending TypeScript repos for a frontend team.",
    },
    {
      label: "Auto · npm zod",
      source: "auto" as SourceKind,
      mode: "general" as BriefMode,
      goal: "Brief the npm package zod for an engineer picking a schema lib.",
      question: "Brief the npm package zod for an engineer picking a schema lib.",
    },
    {
      label: "Auto · Find form libs",
      source: "auto" as SourceKind,
      mode: "general" as BriefMode,
      goal: "Find React form libraries with strong TypeScript support. Shortlist with stars and fit.",
      question: "Find React form libraries with strong TypeScript support. Shortlist with stars and fit.",
    },
    {
      label: "Guided · React risks",
      source: "github" as SourceKind,
      mode: "risks" as BriefMode,
      repo: "facebook/react",
      question: "What are the biggest risks and open issues right now?",
    },
  ],
};

export const DEFAULT_AUTO_GOAL = "Brief facebook/react risks for an eng manager.";
