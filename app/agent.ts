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
    prompt: [
      "You are brief-desk, an engineering assistant.",
      "Use MCP tools to answer questions about GitHub workspaces (issues, PRs, commits)",
      "and local document corpora. Always prefer tool results over guessing.",
      "Cite issue numbers, PR numbers, or document paths when the tools return them.",
    ].join(" "),
    mcpServers: [
      {
        type: "http",
        url: mcpUrl,
      },
    ],
  });
}
