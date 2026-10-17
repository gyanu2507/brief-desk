/**
 * Streamable HTTP MCP server.
 * Tools shell out to workspace-brief / corpus-brief CLIs so the desk stays thin.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || process.env.MCP_PORT || 3108);

function runCmd(command: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim() || "(empty)");
      else reject(new Error(err.trim() || `${command} exited ${code}`));
    });
  });
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "brief-desk-mcp",
    version: "0.1.0",
  });

  server.tool(
    "brief_workspace",
    "Ask any GitHub workspace (or the offline sample) what changed. Returns a cited brief.",
    {
      question: z.string().describe("Plain-English question about the workspace"),
      repo: z
        .string()
        .optional()
        .describe("owner/name for live GitHub; omit to use BRIEF_REPO or offline sample"),
      source: z
        .enum(["fixture", "github"])
        .optional()
        .describe("fixture = offline sample, github = live API"),
    },
    async ({ question, repo, source }) => {
      const src = source || process.env.BRIEF_SOURCE || (repo || process.env.BRIEF_REPO ? "github" : "fixture");
      const args = ["--json", "--source", src, question];
      const target = repo || process.env.BRIEF_REPO;
      if (src === "github") {
        if (!target) {
          return {
            content: [{ type: "text", text: "repo is required for source=github (owner/name)" }],
            isError: true,
          };
        }
        args.splice(3, 0, "--repo", target);
      }
      try {
        const text = await runCmd("brief", args);
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `brief_workspace failed: ${(e as Error).message}. Install workspace-brief (pip install -e path/to/workspace-brief).`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "brief_corpus",
    "Ask a local .md/.txt corpus a question. Returns passages with path citations.",
    {
      question: z.string(),
      corpus: z.string().optional().describe("Directory of docs; omit for bundled sample"),
    },
    async ({ question, corpus }) => {
      const args = ["--json", question];
      if (corpus) args.splice(1, 0, "--corpus", corpus);
      try {
        const text = await runCmd("corpus-brief", args);
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `brief_corpus failed: ${(e as Error).message}. Install corpus-brief (pip install -e path/to/corpus-brief).`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "stack_info",
    "Describe the brief-desk protocol stack (CopilotKit, AG-UI, MCP).",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ui: "CopilotKit React chat",
              protocol: "AG-UI (agent ↔ UI stream via CopilotRuntime)",
              tools: "MCP Streamable HTTP on this server",
              backends: ["workspace-brief (GitHub)", "corpus-brief (local docs)"],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  return server;
}

async function main() {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const http = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, mcp: `http://127.0.0.1:${PORT}/mcp` }));
      return;
    }
    try {
      await transport.handleRequest(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) {
        res.writeHead(500).end("mcp error");
      }
    }
  });

  const host = process.env.HOST || "0.0.0.0";
  http.listen(PORT, host, () => {
    console.log(`brief-desk MCP listening on http://${host}:${PORT}/mcp`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
