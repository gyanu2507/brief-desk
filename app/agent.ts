import { BuiltInAgent } from "@copilotkit/runtime/v2";

const PROVIDER_ALIASES: Record<string, "openai" | "anthropic" | "google"> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  gemini: "google",
};

export function resolveAgentModel(defaultSpec: string): string {
  const value = process.env.COPILOTKIT_AGENT_MODEL?.trim() || defaultSpec;
  const match = /^([A-Za-z0-9-]+)[:/](.+)$/.exec(value.trim());
  const provider = match && PROVIDER_ALIASES[match[1].toLowerCase()];
  if (!match || !provider) {
    throw new Error(
      `COPILOTKIT_AGENT_MODEL="${value}" must look like openai:gpt-4o-mini (or anthropic:/google:)`,
    );
  }
  return `${provider}/${match[2]}`;
}

/**
 * CopilotKit BuiltInAgent streams to the UI over AG-UI.
 * Tools come from the local MCP server (workspace-brief + corpus-brief).
 */
export function createDefaultAgent(): BuiltInAgent {
  const mcpUrl = process.env.MCP_URL || "http://127.0.0.1:3108/mcp";

  return new BuiltInAgent({
    model: resolveAgentModel("openai:gpt-4o-mini"),
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
