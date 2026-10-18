import type { BriefMode, PromptUi, SourceKind } from "./types";

/** Client-safe defaults so demos work even if /api/prompts is slow. */
export const FALLBACK_UI: PromptUi = {
  readableDescription:
    "Active brief-desk session. Prefer brief_auto (or brief_plan+brief_orchestrate). Never brief_workspace. Then draft + brief_eval.",
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
      "Compare vercel/next.js vs remix-run/remix for a SaaS frontend.",
      "Summarize https://modelcontextprotocol.io/introduction for an MCP tool author.",
    ],
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
  },
  sessionNotes: {
    auto: "Call brief_auto once (or brief_plan + brief_orchestrate). Never brief_workspace. Draft + brief_eval.",
    github_ready:
      "Use brief_orchestrate with repo={{repo}} and mode={{mode}}, then brief_eval. Never brief_workspace.",
    github_missing: "Ask user for owner/name or switch to Auto.",
    url_ready: "Use brief_orchestrate with url={{url}}{{repo_suffix}}, mode={{mode}}, then brief_eval.",
    url_missing: "Ask user for a public https URL or switch to Auto.",
    compare_ready: "Use brief_orchestrate mode=compare repo={{repo}} repo_b={{repo_b}}, then brief_eval.",
    compare_missing: "Need two owner/name values, or use Auto with both in the goal.",
    corpus: "Use brief_corpus once, then brief_eval.",
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
      label: "Auto · Next vs Remix",
      source: "auto" as SourceKind,
      mode: "general" as BriefMode,
      goal: "Compare vercel/next.js vs remix-run/remix for a production SaaS frontend. Cite README facts.",
      question: "Compare vercel/next.js vs remix-run/remix for a production SaaS frontend. Cite README facts.",
    },
    {
      label: "Auto · MCP docs",
      source: "auto" as SourceKind,
      mode: "general" as BriefMode,
      goal: "Summarize https://modelcontextprotocol.io/introduction for an engineer building an MCP tool server.",
      question: "Summarize https://modelcontextprotocol.io/introduction for an engineer building an MCP tool server.",
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
