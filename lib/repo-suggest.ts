/** Seed repos for instant local autocomplete before the API returns. */

export type RepoSuggestion = {
  repo: string;
  description?: string | null;
  stars?: number | null;
  source: "seed" | "saved" | "github";
};

export const POPULAR_REPOS: RepoSuggestion[] = [
  { repo: "facebook/react", description: "The library for web and native user interfaces", source: "seed" },
  { repo: "vercel/next.js", description: "The React Framework", source: "seed" },
  { repo: "remix-run/remix", description: "Build Better Websites", source: "seed" },
  { repo: "vuejs/core", description: "Vue.js framework", source: "seed" },
  { repo: "sveltejs/svelte", description: "Cybernetically enhanced web apps", source: "seed" },
  { repo: "angular/angular", description: "Deliver web apps with confidence", source: "seed" },
  { repo: "microsoft/TypeScript", description: "TypeScript language", source: "seed" },
  { repo: "nodejs/node", description: "Node.js JavaScript runtime", source: "seed" },
  { repo: "denoland/deno", description: "A modern runtime for JavaScript and TypeScript", source: "seed" },
  { repo: "rust-lang/rust", description: "Empowering everyone to build reliable software", source: "seed" },
  { repo: "golang/go", description: "The Go programming language", source: "seed" },
  { repo: "python/cpython", description: "The Python programming language", source: "seed" },
  { repo: "pytorch/pytorch", description: "Tensors and dynamic neural networks", source: "seed" },
  { repo: "tensorflow/tensorflow", description: "An Open Source Machine Learning Framework", source: "seed" },
  { repo: "huggingface/transformers", description: "State-of-the-art Machine Learning", source: "seed" },
  { repo: "langchain-ai/langchain", description: "Build context-aware reasoning applications", source: "seed" },
  { repo: "modelcontextprotocol/python-sdk", description: "MCP Python SDK", source: "seed" },
  { repo: "modelcontextprotocol/typescript-sdk", description: "MCP TypeScript SDK", source: "seed" },
  { repo: "openai/openai-python", description: "Official OpenAI Python library", source: "seed" },
  { repo: "anthropics/anthropic-sdk-python", description: "Anthropic Python SDK", source: "seed" },
  { repo: "copilotkit/copilotkit", description: "React UI for AI copilots", source: "seed" },
  { repo: "tailwindlabs/tailwindcss", description: "A utility-first CSS framework", source: "seed" },
  { repo: "shadcn-ui/ui", description: "Beautifully designed components", source: "seed" },
  { repo: "trpc/trpc", description: "End-to-end typesafe APIs", source: "seed" },
  { repo: "prisma/prisma", description: "Next-generation ORM", source: "seed" },
  { repo: "docker/compose", description: "Define and run multi-container applications", source: "seed" },
  { repo: "kubernetes/kubernetes", description: "Production-Grade Container Scheduling", source: "seed" },
  { repo: "hashicorp/terraform", description: "Infrastructure as code", source: "seed" },
  { repo: "grafana/grafana", description: "Open source observability", source: "seed" },
  { repo: "prometheus/prometheus", description: "Systems monitoring toolkit", source: "seed" },
];

export function normalizeRepoQuery(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

export function filterLocalSuggestions(
  query: string,
  extras: RepoSuggestion[] = [],
  limit = 8,
): RepoSuggestion[] {
  const q = normalizeRepoQuery(query).toLowerCase();
  const seen = new Set<string>();
  const out: RepoSuggestion[] = [];

  const push = (item: RepoSuggestion) => {
    const key = item.repo.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  const pool = [...extras, ...POPULAR_REPOS];
  if (!q) {
    for (const item of pool) {
      push(item);
      if (out.length >= limit) break;
    }
    return out;
  }

  const scored = pool
    .map((item) => {
      const repo = item.repo.toLowerCase();
      const [owner, name = ""] = repo.split("/");
      let score = 0;
      if (repo === q) score = 100;
      else if (repo.startsWith(q)) score = 90;
      else if (owner.startsWith(q) || name.startsWith(q)) score = 80;
      else if (repo.includes(q)) score = 60;
      else if ((item.description || "").toLowerCase().includes(q)) score = 40;
      else return null;
      return { item, score };
    })
    .filter((x): x is { item: RepoSuggestion; score: number } => Boolean(x))
    .sort((a, b) => b.score - a.score || a.item.repo.localeCompare(b.item.repo));

  for (const row of scored) {
    push(row.item);
    if (out.length >= limit) break;
  }
  return out;
}
