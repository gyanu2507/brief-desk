/**
 * Streamable HTTP MCP server (stateless).
 * Tools call GitHub APIs and/or workspace-brief / corpus-brief CLIs.
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…[truncated]`;
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

async function githubApi(path: string, accept?: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept || "application/vnd.github+json",
    "User-Agent": "brief-desk-mcp",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`https://api.github.com${path}`, { headers });
}

async function githubJson<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await githubApi(path);
  if (!res.ok) {
    return { ok: false, status: res.status, error: truncate(await res.text(), 400) };
  }
  return { ok: true, data: (await res.json()) as T };
}

function searchTerms(question: string): string {
  return question
    .replace(/https?:\/\/github\.com\/[^\s]+/gi, " ")
    .replace(/[^\w\s./+-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(the|and|for|with|what|how|are|this|that|from|about|repo|github|all|main)$/i.test(w))
    .slice(0, 8)
    .join(" ");
}

async function decodeContentFile(path: string, repo: string): Promise<{ path: string; text: string } | null> {
  const res = await githubJson<{
    type?: string;
    encoding?: string;
    content?: string;
    path?: string;
    size?: number;
  }>(`/repos/${repo}/contents/${encodeURI(path)}`);
  if (!res.ok || res.data.type !== "file" || res.data.encoding !== "base64" || !res.data.content) {
    return null;
  }
  if ((res.data.size ?? 0) > 200_000) {
    return { path: res.data.path || path, text: "[file too large to inline]" };
  }
  const text = Buffer.from(res.data.content.replace(/\n/g, ""), "base64").toString("utf8");
  return { path: res.data.path || path, text: truncate(text, 6000) };
}

async function fetchRepoMeta(repo: string) {
  const res = await githubJson<{
    full_name?: string;
    description?: string | null;
    homepage?: string | null;
    topics?: string[];
    language?: string | null;
    stargazers_count?: number;
    html_url?: string;
    default_branch?: string;
    open_issues_count?: number;
    license?: { spdx_id?: string } | null;
  }>(`/repos/${repo}`);
  if (!res.ok) throw new Error(`repo lookup failed (${res.status}): ${res.error}`);
  return res.data;
}

async function fetchReadme(repo: string): Promise<string> {
  const res = await githubJson<{ content?: string; encoding?: string }>(`/repos/${repo}/readme`);
  if (!res.ok) return res.status === 404 ? "" : `[readme error ${res.status}]`;
  if (res.data.encoding !== "base64" || !res.data.content) return "";
  return truncate(Buffer.from(res.data.content.replace(/\n/g, ""), "base64").toString("utf8"), 10000);
}

async function fetchIssueHits(repo: string, question: string) {
  const q = encodeURIComponent(`${searchTerms(question) || "is:issue"} repo:${repo}`);
  const res = await githubJson<{
    items?: Array<{
      html_url?: string;
      title?: string;
      state?: string;
      number?: number;
      body?: string | null;
      pull_request?: unknown;
    }>;
  }>(`/search/issues?q=${q}&per_page=8`);
  if (!res.ok) return { error: `${res.status}: ${res.error}`, items: [] as const };
  return {
    items: (res.data.items || []).map((it) => ({
      number: it.number,
      title: it.title,
      state: it.state,
      kind: it.pull_request ? "pr" : "issue",
      url: it.html_url,
      body: truncate((it.body || "").replace(/\r/g, ""), 500),
    })),
  };
}

async function fetchCodeHits(repo: string, question: string) {
  const terms = searchTerms(question);
  if (!terms) return { items: [] as const, note: "no search terms" };
  const q = encodeURIComponent(`${terms} repo:${repo}`);
  const res = await githubJson<{
    items?: Array<{
      path?: string;
      html_url?: string;
      sha?: string;
      text_matches?: Array<{ fragment?: string }>;
    }>;
  }>(`/search/code?q=${q}&per_page=6`);
  if (!res.ok) {
    return {
      error: `${res.status}: ${res.error}`,
      note:
        res.status === 401 || res.status === 403
          ? "Code search needs GITHUB_TOKEN on the MCP host."
          : undefined,
      items: [] as const,
    };
  }
  const items = res.data.items || [];
  const files: Array<{ path: string; url?: string; fragment?: string; preview?: string }> = [];
  for (const hit of items.slice(0, 4)) {
    if (!hit.path) continue;
    const file = await decodeContentFile(hit.path, repo);
    files.push({
      path: hit.path,
      url: hit.html_url,
      fragment: hit.text_matches?.[0]?.fragment,
      preview: file?.text,
    });
  }
  return { items: files };
}

async function fetchRootListing(repo: string, branch: string) {
  const res = await githubJson<Array<{ name?: string; path?: string; type?: string; size?: number }>>(
    `/repos/${repo}/contents?ref=${encodeURIComponent(branch)}`,
  );
  if (!res.ok) return { error: `${res.status}: ${res.error}`, entries: [] as const };
  return {
    entries: (res.data || []).slice(0, 40).map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type,
      size: e.size,
    })),
  };
}

async function fetchReleases(repo: string) {
  const res = await githubJson<
    Array<{ tag_name?: string; name?: string; html_url?: string; prerelease?: boolean; published_at?: string }>
  >(`/repos/${repo}/releases?per_page=5`);
  if (!res.ok) return { error: `${res.status}: ${res.error}`, items: [] as const };
  return {
    items: (res.data || []).map((r) => ({
      tag: r.tag_name,
      name: r.name,
      url: r.html_url,
      prerelease: r.prerelease,
      published_at: r.published_at,
    })),
  };
}

/** Broad pack: README + tree + issues/PRs + code hits + releases. */
async function fetchRepoAsk(repo: string, question: string): Promise<string> {
  const meta = await fetchRepoMeta(repo);
  const branch = meta.default_branch || "main";
  const [readme, issues, code, root, releases] = await Promise.all([
    fetchReadme(repo),
    fetchIssueHits(repo, question),
    fetchCodeHits(repo, question),
    fetchRootListing(repo, branch),
    fetchReleases(repo),
  ]);

  return JSON.stringify(
    {
      question,
      repo: meta.full_name || repo,
      url: meta.html_url || `https://github.com/${repo}`,
      description: meta.description || "",
      homepage: meta.homepage || "",
      topics: meta.topics || [],
      language: meta.language || "",
      stars: meta.stargazers_count ?? 0,
      open_issues: meta.open_issues_count ?? 0,
      license: meta.license?.spdx_id || "",
      default_branch: branch,
      readme,
      root,
      issues_and_prs: issues,
      code,
      releases,
      guidance:
        "Answer using this evidence. Cite file paths, issue/PR numbers, and README sections. If something is missing, say what was not found.",
    },
    null,
    2,
  );
}

async function fetchRepoOverview(repo: string): Promise<string> {
  const meta = await fetchRepoMeta(repo);
  const readme = await fetchReadme(repo);
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
    version: "0.2.0",
  });

  server.tool(
    "brief_repo_ask",
    "Default tool for any question about a GitHub repo. Pulls README, root tree, matching issues/PRs, code search hits (with file previews), and recent releases in one pack.",
    {
      question: z.string().describe("The user question about the repository"),
      repo: z.string().describe("owner/name (or https://github.com/owner/name)"),
    },
    async ({ question, repo }) => {
      const target = normalizeGithubRepo(repo || process.env.BRIEF_REPO);
      if (!target) {
        return {
          content: [{ type: "text", text: "repo is required (owner/name)" }],
          isError: true,
        };
      }
      try {
        const text = await fetchRepoAsk(target, question);
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `brief_repo_ask failed: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "brief_repo_overview",
    "Fetch only description + README. Prefer brief_repo_ask unless you already have enough context.",
    {
      repo: z.string().describe("owner/name (also accepts https://github.com/owner/name)"),
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
        return { content: [{ type: "text", text: await fetchRepoOverview(target) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `brief_repo_overview failed: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "brief_repo_file",
    "Read one file from a GitHub repo by path (e.g. src/cli.ts, docs/guide.md).",
    {
      repo: z.string().describe("owner/name"),
      path: z.string().describe("File path in the repository"),
    },
    async ({ repo, path }) => {
      const target = normalizeGithubRepo(repo || process.env.BRIEF_REPO);
      if (!target) {
        return {
          content: [{ type: "text", text: "repo is required (owner/name)" }],
          isError: true,
        };
      }
      try {
        const file = await decodeContentFile(path.replace(/^\//, ""), target);
        if (!file) {
          return {
            content: [{ type: "text", text: `File not found or not a file: ${path}` }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(file, null, 2) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `brief_repo_file failed: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "brief_workspace",
    "Deeper activity brief via workspace-brief CLI (issues/PRs/commits). Use after brief_repo_ask when you need a cited activity summary, or for the offline fixture sample.",
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
    "Ask a local .md/.txt corpus a question (bundled sample docs). Not for remote GitHub repos.",
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
                "brief_repo_ask (README + code + issues + releases)",
                "brief_repo_file",
                "workspace-brief (activity)",
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
