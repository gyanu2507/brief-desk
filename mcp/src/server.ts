/**
 * Streamable HTTP MCP server (stateless).
 * Tools shell out to workspace-brief / corpus-brief CLIs.
 */
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || process.env.MCP_PORT || 3108);
const HOST = process.env.HOST || "0.0.0.0";

function runCmd(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
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

function createBriefMcpServer(): McpServer {
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
      const src =
        source || process.env.BRIEF_SOURCE || (repo || process.env.BRIEF_REPO ? "github" : "fixture");
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
              text: `brief_workspace failed: ${(e as Error).message}. Install workspace-brief.`,
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
              text: `brief_corpus failed: ${(e as Error).message}. Install corpus-brief.`,
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

const app = createMcpExpressApp();

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    mcp: "/mcp",
    service: "brief-desk-mcp",
  });
});

app.get("/", (_req, res) => {
  res.status(200).type("html").send(`<!doctype html>
<html><body style="font-family:system-ui;padding:2rem;max-width:40rem">
  <h1>brief-desk MCP</h1>
  <p>This is the tool server, not the chat UI.</p>
  <ul>
    <li><a href="/health">/health</a></li>
    <li>MCP endpoint: <code>POST /mcp</code></li>
  </ul>
  <p>Deploy the Next.js app on Vercel and set <code>MCP_URL</code> to this host + <code>/mcp</code>.</p>
</body></html>`);
});

app.post("/mcp", async (req, res) => {
  const server = createBriefMcpServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. Use POST /mcp." },
    id: null,
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.listen(PORT, HOST, () => {
  console.log(`brief-desk MCP listening on http://${HOST}:${PORT}`);
  console.log(`health: /health   mcp: POST /mcp`);
});
