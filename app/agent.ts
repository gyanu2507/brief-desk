import { BuiltInAgent } from "@copilotkit/runtime/v2";

const PROVIDER_ALIASES: Record<string, "openai" | "anthropic" | "google"> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  gemini: "google",
};

/**
 * Groq free/dev tier shut the old Llama ids down. CopilotKit parses
 * `provider/modelId` on the first slash, so Groq's `openai/gpt-oss-20b`
 * must be passed as `openai/openai/gpt-oss-20b` (modelId keeps the slash).
 */
const GROQ_MODEL_ALIASES: Record<string, string> = {
  "llama-3.3-70b-versatile": "openai/gpt-oss-20b",
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
  "llama-3.1-70b-versatile": "openai/gpt-oss-20b",
  "gpt-oss-20b": "openai/gpt-oss-20b",
  "gpt-oss-120b": "openai/gpt-oss-120b",
};

export function resolveAgentModel(defaultSpec: string): string {
  const value = process.env.COPILOTKIT_AGENT_MODEL?.trim() || defaultSpec;
  const match = /^([A-Za-z0-9-]+)[:/](.+)$/.exec(value.trim());
  const provider = match && PROVIDER_ALIASES[match[1].toLowerCase()];
  if (!match || !provider) {
    throw new Error(
      `COPILOTKIT_AGENT_MODEL="${value}" must look like openai:openai/gpt-oss-20b (or anthropic:/google:)`,
    );
  }
  const modelId = GROQ_MODEL_ALIASES[match[2]] ?? match[2];
  return `${provider}/${modelId}`;
}

/**
 * CopilotKit BuiltInAgent streams to the UI over AG-UI.
 * Tools come from the MCP server (orchestrator + GitHub + URL + corpus + eval).
 */
export function createDefaultAgent(): BuiltInAgent {
  const mcpUrl = process.env.MCP_URL || "http://127.0.0.1:3108/mcp";

  return new BuiltInAgent({
    model: resolveAgentModel("openai:openai/gpt-oss-20b"),
    maxSteps: 10,
    prompt: [
      "You are brief-desk, an engineering briefing agent with an orchestrator + eval loop.",
      "Sources can be: GitHub repos, public docs URLs, or the local corpus sample. Not GitHub-only.",
      "Use only tools that appear in your tool list (never invent tool names).",
      "Default loop for non-trivial questions:",
      "1) brief_orchestrate (pass repo and/or url; mode optional: overview|risks|architecture|activity|code|docs|compare|general)",
      "2) draft an answer from the gather pack only",
      "3) brief_eval with question + draft + short evidence excerpt",
      "4) if pass=false, revise once using revisions, then answer the user",
      "Compare two repos: mode=compare with repo + repo_b.",
      "Public docs / RFCs / blogs: pass url= to brief_orchestrate or brief_fetch_url.",
      "Local sample docs only: brief_corpus.",
      "Tiny follow-ups can skip orchestrate and use brief_repo_file / brief_repo_overview / brief_workspace.",
      "Always cite paths, #issue/#PR, or source URLs. If evidence is missing, say what is missing.",
      "If a tool errors (rate limit, too large, missing token), explain briefly and answer with what you have.",
    ].join(" "),
    mcpServers: [
      {
        type: "http",
        url: mcpUrl,
      },
    ],
  });
}
