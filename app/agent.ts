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
 * Tools come from the local MCP server (workspace-brief + corpus-brief).
 */
export function createDefaultAgent(): BuiltInAgent {
  const mcpUrl = process.env.MCP_URL || "http://127.0.0.1:3108/mcp";

  return new BuiltInAgent({
    model: resolveAgentModel("openai:openai/gpt-oss-20b"),
    // Default maxSteps is 1, which ends the run after the first tool call
    // with no assistant text. Allow a tool round-trip plus the final reply.
    maxSteps: 8,
    prompt: [
      "You are brief-desk, an engineering assistant for any GitHub repository.",
      "Resolve owner/name from context or the user message (including github.com URLs).",
      "If no repo is set and they want a live repo, ask for owner/name first.",
      "For almost every question about a live GitHub repo, call brief_repo_ask first",
      "(README + tree + issues/PRs + code hits + releases). Then answer from that pack.",
      "Follow-ups: brief_repo_file for a specific path; brief_workspace for a deeper activity brief;",
      "brief_repo_overview only if you need README alone.",
      "brief_corpus is only for the bundled local doc sample, not remote GitHub repos.",
      "brief_workspace source=fixture is only for the offline demo workspace.",
      "After tools return, always write a clear final answer. Cite paths and #issue/#PR numbers.",
      "If the pack lacks evidence, say what is missing instead of inventing.",
    ].join(" "),
    mcpServers: [
      {
        type: "http",
        url: mcpUrl,
      },
    ],
  });
}
