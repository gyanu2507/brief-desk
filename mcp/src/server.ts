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
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function normalizeGithubRepo(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  return REPO_RE.test(trimmed) ? trimmed : undefined;
}

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

async function githubApi(path: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "brief-desk-mcp",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`https://api.github.com${path}`, { headers });
}

/** Repo description + README for "what is this / features" questions. */
async function fetchRepoOverview(repo: string): Promise<string> {
  const metaRes = await githubApi(`/repos/${repo}`);
  if (!metaRes.ok) {
    throw new Error(`GitHub repo lookup failed (${metaRes.status}): ${await metaRes.text()}`);
  }
  const meta = (await metaRes.json()) as {
    full_name?: string;
    description?: string | null;
    homepage?: string | null;
    topics?: string[];
    language?: string | null;
    stargazers_count?: number;
    html_url?: string;
    default_branch?: string;
  };

  let readme = "";
  const readmeRes = await githubApi(`/repos/${repo}/readme`);
  if (readmeRes.ok) {
    const body = (await readmeRes.json()) as { content?: string; encoding?: string; path?: string };
    if (body.encoding === "base64" && body.content) {
      readme = Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8");
    }
  } else if (readmeRes.status !== 404) {
    throw new Error(`GitHub README lookup failed (${readmeRes.status})`);
  }

  // Cap so the chat model is not flooded
  const maxReadme = 12000;
  if (readme.length > maxReadme) {
    readme = `${readme.slice(0, maxReadme)}\n\n…[README truncated]`;
  }

  return JSON.stringify(
    {
      repo: meta.full_name || repo,
      url: meta.html_url || `https://github.com/${repo}`,
      description: meta.description || "",
      homepage: meta.homepage || "",
      topics: meta.topics || [],
      language: meta.language || "",
      stars: meta.stargazers_count ?? 0,
      default_branch: meta.default_branch || "main",
      readme,
    },
    null,
    2,
  );
}

function createBriefMcpServer(): McpServer {
  const server = new McpServer({
    name: "brief-desk-mcp",
    version: "0.1.0",
  });

  server.tool(
    "brief_repo_overview",
    "Fetch a GitHub repo description + README. Use for what the project is, features, getting started, architecture overview. Not for issue/PR activity.",
    {
      repo: z
        .string()
        .describe("owner/name (also accepts https://github.com/owner/name)"),
    },
    async ({ repo }) => {
      const target = normalizeGithubRepo(repo || process.env.BRIEF_REPO);
      if (!target) {
        return {
          content: [{ type: "text", text: "repo is required (owner/name)" }],
          isError: true,
        };
      }
      try {
        const text = await fetchRepoOverview(target);
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `brief_repo_overview failed: ${(e as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "brief_workspace",
    "Search GitHub issues/PRs/commits (or the offline sample) for activity questions: open bugs, risks, what landed. Not for product feature lists from the README; use brief_repo_overview for that.",
    {
      question: z.string().describe("Plain-English question about the workspace"),
      repo: z
        .string()
        .optional()
        .describe("owner/name for live GitHub (also accepts https://github.com/owner/name)"),
      source: z
        .enum(["fixture", "github"])
        .optional()
        .describe("github = live API (default when repo is set); fixture = offline sample"),
    },
    async ({ question, repo, source }) => {
      const target = normalizeGithubRepo(repo || process.env.BRIEF_REPO);
      const src =
        source ||
        (target ? "github" : undefined) ||
        process.env.BRIEF_SOURCE ||
        "fixture";
      const args = ["--json", "--source", src, question];
      if (src === "github") {
        if (!target) {
          return {
            content: [
              {
                type: "text",
                text: "repo is required for source=github (pass owner/name)",
              },
            ],
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
              text: `brief_workspace failed: ${(e as Error).message}. Install workspace-brief and set GITHUB_TOKEN on the MCP host for higher rate limits.`,
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
              backends: [
                "brief_repo_overview (README)",
                "workspace-brief (issues/PRs)",
                "corpus-brief (local docs)",
              ],
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

const allowedHosts = [
  "localhost",
  "127.0.0.1",
  "brief-desk.onrender.com",
  ...(process.env.MCP_ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean) ?? []),
];

// host must not stay at the SDK default (127.0.0.1) or Render's Host header is rejected.
const app = createMcpExpressApp({
  host: "0.0.0.0",
  allowedHosts,
});

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
