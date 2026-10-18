/**
 * Streamable HTTP MCP server (stateless).
 * Tools call GitHub APIs and/or workspace-brief / corpus-brief CLIs.
 */
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";
import {
  buildAutonomousPlan,
  classifyBriefMode,
  normalizeGithubRepo,
  planForMode,
  type BriefMode,
} from "./plan";

const PORT = Number(process.env.PORT || process.env.MCP_PORT || 3108);
const HOST = process.env.HOST || "0.0.0.0";

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

async function fetchPublicUrl(url: string): Promise<{ url: string; text: string; note?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("only http/https URLs are allowed");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.endsWith(".local")) {
    throw new Error("local URLs are blocked");
  }
  const res = await fetch(parsed.toString(), {
    headers: { "User-Agent": "brief-desk-mcp", Accept: "text/plain, text/markdown, text/html, */*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const ctype = res.headers.get("content-type") || "";
  let raw = await res.text();
  if (ctype.includes("html") || /<html[\s>]/i.test(raw)) {
    raw = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return {
    url: parsed.toString(),
    text: truncate(raw, 6000),
    note: ctype.includes("html") ? "html_stripped" : undefined,
  };
}

function evalDraft(question: string, draft: string, evidence: string): Record<string, unknown> {
  const q = question.toLowerCase();
  const d = draft.trim();
  const e = evidence.toLowerCase();
  const words = q
    .replace(/[^\w\s./+-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 12);
  const hit = words.filter((w) => d.toLowerCase().includes(w)).length;
  const coverage = words.length ? hit / words.length : 0.5;
  const hasCite =
    /#\d+/.test(d) ||
    /\b[\w.-]+\.(ts|tsx|js|jsx|py|go|rs|md|json|yml|yaml)\b/i.test(d) ||
    /https?:\/\/github\.com\//i.test(d) ||
    /`[^`]+`/.test(d);
  const inventRisk =
    /\b(always|never|guarantees?|100%|definitely)\b/i.test(d) && !hasCite && evidence.length < 200;
  const grounded = evidence.length > 40 && (hasCite || coverage >= 0.35);
  const completeness = Math.min(1, d.length / 280) * 0.5 + coverage * 0.5;
  const citation = hasCite ? 1 : e.includes("readme") || e.includes("path") ? 0.4 : 0.15;
  const groundedness = inventRisk ? 0.25 : grounded ? 0.85 : 0.45;
  const overall = Number(((groundedness * 0.45 + completeness * 0.35 + citation * 0.2) * 100).toFixed(1));
  const pass = overall >= 55 && !inventRisk;
  const revisions: string[] = [];
  if (!hasCite) revisions.push("Add citations: file paths, #issue/#PR, or source URLs from the evidence.");
  if (coverage < 0.35) revisions.push("Address more of the user question terms explicitly.");
  if (d.length < 120) revisions.push("Expand the answer with concrete evidence details.");
  if (inventRisk) revisions.push("Remove absolute claims that are not backed by the pack.");
  if (pass && revisions.length === 0) revisions.push("Ship as-is.");
  return {
    scores: {
      groundedness: Number(groundedness.toFixed(2)),
      completeness: Number(completeness.toFixed(2)),
      citation: Number(citation.toFixed(2)),
      overall,
    },
    pass,
    revisions,
    note: "Free heuristic rubric (no paid eval API). Use revisions before the final user-facing answer.",
  };
}

async function runOrchestrate(args: {
  question: string;
  repo?: string;
  repo_b?: string;
  url?: string;
  mode?: BriefMode;
}): Promise<string> {
  const mode = args.mode || classifyBriefMode(args.question);
  const repo = normalizeGithubRepo(args.repo);
  const repoB = normalizeGithubRepo(args.repo_b);
  const url = args.url?.trim();
  const plan = planForMode(mode, Boolean(repo), Boolean(url));
  const stages: Record<string, unknown> = { plan, mode };

  if (mode === "compare") {
    if (!repo || !repoB) {
      return JSON.stringify({
        plan,
        mode,
        error: "compare mode needs repo and repo_b (owner/name)",
        next: "Ask the user for both repositories, then call brief_orchestrate again.",
      });
    }
    const [a, b] = await Promise.all([fetchRepoOverview(repo), fetchRepoOverview(repoB)]);
    stages.gather = {
      a: JSON.parse(a),
      b: JSON.parse(b),
    };
    stages.guidance =
      "Write a side-by-side comparison (purpose, stack, maturity, when to pick which). Cite README facts. Then call brief_eval on your draft.";
  } else if (url) {
    stages.gather = { url: await fetchPublicUrl(url) };
    if (repo) {
      stages.gather = {
        ...(stages.gather as object),
        repo: JSON.parse(await fetchRepoOverview(repo)),
      };
    }
    stages.guidance =
      "Answer using the URL text (and repo pack if present). Cite the URL. Then call brief_eval on your draft.";
  } else if (repo) {
    if (mode === "overview") stages.gather = JSON.parse(await fetchRepoOverview(repo));
    else if (mode === "docs") {
      stages.gather = {
        overview: JSON.parse(await fetchRepoOverview(repo)),
        hint: "If the user wants local docs only, also call brief_corpus.",
      };
    } else {
      stages.gather = JSON.parse(await fetchRepoAsk(repo, args.question));
    }
    stages.guidance =
      "Answer from gather only. Cite paths and #issue/#PR numbers. Then call brief_eval with question, draft, and a short evidence excerpt.";
  } else {
    stages.gather = {
      note: "No repo/url. Call brief_corpus for the bundled sample, or ask the user for owner/name or a public docs URL.",
    };
    stages.guidance = "If using corpus, answer from brief_corpus output, then brief_eval.";
  }

  let text = JSON.stringify(stages, null, 2);
  if (text.length > 14000) text = truncate(text, 14000);
  return text;
}

function createBriefMcpServer(): McpServer {
  const server = new McpServer({
    name: "brief-desk-mcp",
    version: "0.5.0",
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
    "brief_plan",
    "Autonomous planner: from a free-form goal, invent source/mode/repos/URL, subgoals, tool steps, and success criteria. Call this first in auto mode before brief_orchestrate.",
    {
      goal: z.string().describe("Free-form user goal (may include owner/name or https URLs)"),
    },
    async ({ goal }) => ({
      content: [{ type: "text", text: JSON.stringify(buildAutonomousPlan(goal), null, 2) }],
    }),
  );

  server.tool(
    "brief_orchestrate",
    "Multi-source orchestrator (free): plan → gather → guidance. Modes cover GitHub repos, public docs URLs, local corpus hints, risks/architecture/activity/code, and two-repo compare. Prefer this for non-trivial questions.",
    {
      question: z.string().describe("User question"),
      repo: z.string().optional().describe("Primary GitHub owner/name"),
      repo_b: z.string().optional().describe("Second repo for compare mode"),
      url: z.string().optional().describe("Public http(s) docs/page URL to fetch"),
      mode: z
        .enum(["overview", "risks", "architecture", "activity", "code", "docs", "compare", "general"])
        .optional()
        .describe("Override auto-detected brief mode"),
    },
    async ({ question, repo, repo_b, url, mode }) => {
      try {
        const text = await runOrchestrate({ question, repo, repo_b, url, mode });
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `brief_orchestrate failed: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "brief_eval",
    "Free heuristic eval rubric for a draft answer (groundedness, completeness, citations). No paid eval API. Call after drafting; revise if pass=false.",
    {
      question: z.string(),
      draft: z.string().describe("Candidate answer to score"),
      evidence: z
        .string()
        .describe("Short excerpt or summary of the tool evidence used (not the full pack)"),
    },
    async ({ question, draft, evidence }) => ({
      content: [{ type: "text", text: JSON.stringify(evalDraft(question, draft, evidence), null, 2) }],
    }),
  );

  server.tool(
    "brief_fetch_url",
    "Fetch a public http(s) page or raw doc (HTML stripped). Use for docs sites, RFCs, blog posts, raw GitHub files. Localhost blocked.",
    {
      url: z.string().describe("https://... public URL"),
    },
    async ({ url }) => {
      try {
        const pack = await fetchPublicUrl(url);
        return { content: [{ type: "text", text: JSON.stringify(pack, null, 2) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `brief_fetch_url failed: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "stack_info",
    "Describe the brief-desk protocol stack (CopilotKit, AG-UI, MCP, orchestrator, eval).",
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
              loop: "brief_plan (auto) → brief_orchestrate → draft → brief_eval → revise",
              backends: [
                "GitHub (overview/ask/file/workspace)",
                "public URL fetch",
                "local corpus-brief",
                "free heuristic eval rubric",
                "autonomous goal planner",
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
    version: "0.5.0",
    tools: [
      "brief_plan",
      "brief_orchestrate",
      "brief_eval",
      "brief_fetch_url",
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
