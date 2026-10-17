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

type AskIntent = "overview" | "activity" | "code" | "mixed";

function classifyAskIntent(question: string): AskIntent {
  const q = question.toLowerCase();
  const overview =
    /\b(feature|features|overview|what is|what does|readme|getting started|about this|describe|summary of the (repo|project))\b/.test(
      q,
    );
  const activity =
    /\b(issue|issues|pr|prs|pull request|bug|risk|risks|landed|merged|open|activity|changelog|release)\b/.test(q);
  const code =
    /\b(how does|where is|implement|implemented|code|source|function|class|file|path|api|endpoint|config)\b/.test(q);
  if (overview && !activity && !code) return "overview";
  if (activity && !code && !overview) return "activity";
  if (code && !activity) return "code";
  if (overview && activity && !code) return "activity";
  return "mixed";
}

type CacheEntry = { expires: number; value: unknown };
const ttlCache = new Map<string, CacheEntry>();
const META_TTL_MS = 60_000;
const README_TTL_MS = 60_000;

function cacheGet<T>(key: string): T | undefined {
  const hit = ttlCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    ttlCache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown, ttlMs: number): void {
  ttlCache.set(key, { expires: Date.now() + ttlMs, value });
  if (ttlCache.size > 200) {
    const first = ttlCache.keys().next().value;
    if (first !== undefined) ttlCache.delete(first);
  }
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
  return { path: res.data.path || path, text: truncate(text, 1800) };
}

async function fetchRepoMeta(repo: string) {
  const cached = cacheGet<Awaited<ReturnType<typeof fetchRepoMetaUncached>>>(`meta:${repo}`);
  if (cached) return cached;
  const data = await fetchRepoMetaUncached(repo);
  cacheSet(`meta:${repo}`, data, META_TTL_MS);
  return data;
}

async function fetchRepoMetaUncached(repo: string) {
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

async function fetchReadme(repo: string, maxChars = 3500): Promise<string> {
  const key = `readme:${repo}:${maxChars}`;
  const cached = cacheGet<string>(key);
  if (cached !== undefined) return cached;
  const res = await githubJson<{ content?: string; encoding?: string }>(`/repos/${repo}/readme`);
  if (!res.ok) {
    const text = res.status === 404 ? "" : `[readme error ${res.status}]`;
    cacheSet(key, text, README_TTL_MS);
    return text;
  }
  if (res.data.encoding !== "base64" || !res.data.content) {
    cacheSet(key, "", README_TTL_MS);
    return "";
  }
  // Keep small: Groq free tier TPM rejects oversized tool payloads.
  const text = truncate(Buffer.from(res.data.content.replace(/\n/g, ""), "base64").toString("utf8"), maxChars);
  cacheSet(key, text, README_TTL_MS);
  return text;
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
  }>(`/search/issues?q=${q}&per_page=5`);
  if (!res.ok) return { error: `${res.status}: ${res.error}`, items: [] as const };
  return {
    items: (res.data.items || []).map((it) => ({
      number: it.number,
      title: it.title,
      state: it.state,
      kind: it.pull_request ? "pr" : "issue",
      url: it.html_url,
      body: truncate((it.body || "").replace(/\r/g, ""), 180),
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
  }>(`/search/code?q=${q}&per_page=4`);
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
  for (const hit of items.slice(0, 2)) {
    if (!hit.path) continue;
    const file = await decodeContentFile(hit.path, repo);
    files.push({
      path: hit.path,
      url: hit.html_url,
      fragment: truncate(hit.text_matches?.[0]?.fragment || "", 240),
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
    entries: (res.data || []).slice(0, 20).map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type,
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

/** Intent-shaped pack: pull only the slices that answer the question. */
async function fetchRepoAsk(repo: string, question: string): Promise<string> {
  const intent = classifyAskIntent(question);
  const meta = await fetchRepoMeta(repo);
  const branch = meta.default_branch || "main";

  const wantReadme = intent === "overview" || intent === "mixed" || intent === "code";
  const wantRoot = intent === "overview" || intent === "mixed" || intent === "code";
  const wantIssues = intent === "activity" || intent === "mixed";
  const wantCode = intent === "code" || intent === "mixed";
  const wantReleases = intent === "activity" || intent === "mixed" || intent === "overview";
  const readmeMax = intent === "overview" ? 3500 : intent === "code" ? 1800 : 2200;

  const [readme, issues, code, root, releases] = await Promise.all([
    wantReadme ? fetchReadme(repo, readmeMax) : Promise.resolve(""),
    wantIssues ? fetchIssueHits(repo, question) : Promise.resolve({ items: [] as const, skipped: true }),
    wantCode ? fetchCodeHits(repo, question) : Promise.resolve({ items: [] as const, skipped: true }),
    wantRoot ? fetchRootListing(repo, branch) : Promise.resolve({ entries: [] as const, skipped: true }),
    wantReleases ? fetchReleases(repo) : Promise.resolve({ items: [] as const, skipped: true }),
  ]);

  const pack: Record<string, unknown> = {
    question,
    intent,
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
    guidance:
      "Answer using this evidence. Cite file paths, issue/PR numbers, and README sections. If something is missing, say what was not found.",
  };
  if (wantReadme) pack.readme = readme;
  if (wantRoot) pack.root = root;
  if (wantIssues) pack.issues_and_prs = issues;
  if (wantCode) pack.code = code;
  if (wantReleases) pack.releases = releases;
  if (!wantCode && intent === "overview") {
    pack.note = "Overview pack (no code search). Use brief_repo_ask with a code question or brief_repo_file for paths.";
  }

  let text = JSON.stringify(pack, null, 2);
  // Hard cap for Groq free TPM. Leave room for the model prompt/tools.
  if (text.length > 14000 && wantReadme) {
    text = JSON.stringify(
      {
        ...pack,
        readme: truncate(typeof readme === "string" ? readme : "", 1400),
        code: wantCode ? { note: "omitted to fit model limit; use brief_repo_file" } : undefined,
      },
      null,
      2,
    );
  }
  if (text.length > 14000) {
    text = truncate(text, 14000);
  }
  return text;
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
    version: "0.3.0",
  });

  server.tool(
    "brief_repo_ask",
    "Ask about a GitHub repo. Shapes the evidence pack by intent (overview / activity / code / mixed) so payloads stay under model TPM limits.",
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
    "Fetch description + README only. Prefer for features / what-is-this questions.",
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
    version: "0.3.0",
    tools: [
      "brief_repo_ask",
      "brief_repo_overview",
      "brief_repo_file",
      "brief_workspace",
      "brief_corpus",
      "stack_info",
    ],
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
