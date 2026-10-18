/** Direct scrape of github.com/trending when MCP lacks brief_github_trending. */

export type TrendingRepo = {
  repo: string;
  url?: string;
  description?: string | null;
  stars_delta?: string | null;
  stars_period?: string | null;
  language?: string | null;
};

export type TrendingResult = {
  source: "github_trending";
  url: string;
  language: string | null;
  since: string;
  repos: TrendingRepo[];
  cached: boolean;
  error?: string;
  guidance?: string;
};

const SINCE_MAP: Record<string, string> = {
  daily: "daily",
  week: "weekly",
  weekly: "weekly",
  month: "monthly",
  monthly: "monthly",
};

const CACHE_TTL_MS = 12 * 60 * 1000;
const cache = new Map<string, { expires: number; payload: TrendingResult }>();

function normalizeSince(since?: string | null): string {
  const key = (since || "weekly").trim().toLowerCase();
  return SINCE_MAP[key] || "weekly";
}

function normalizeLanguage(language?: string | null): string | null {
  if (!language) return null;
  const lang = language.trim().toLowerCase().replace(/ /g, "-");
  if (lang === "any" || lang === "all" || lang === "*") return null;
  return encodeURIComponent(lang);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function parseTrendingHtml(html: string, limit: number): TrendingRepo[] {
  const articles = html.match(
    /<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>[\s\S]*?<\/article>/gi,
  );
  if (!articles) return [];

  const out: TrendingRepo[] = [];
  for (const block of articles) {
    if (out.length >= limit) break;
    const href =
      block.match(/<h2[^>]*>\s*<a[^>]+href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/i) ||
      block.match(/href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/i);
    if (!href) continue;
    const repo = href[1];
    if (repo.startsWith("sponsors/") || repo.startsWith("login")) continue;

    const descM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const desc = descM ? stripTags(descM[1]) : "";
    const starsM = block.match(/([\d,]+)\s+stars?\s+(today|this week|this month)/i);
    const langM = block.match(/itemprop="programmingLanguage"[^>]*>\s*([^<]+)/i);

    out.push({
      repo,
      url: `https://github.com/${repo}`,
      description: desc ? desc.slice(0, 240) : null,
      stars_delta: starsM ? starsM[1].replace(/,/g, "") : null,
      stars_period: starsM ? starsM[2].toLowerCase() : null,
      language: langM ? langM[1].trim() : null,
    });
  }
  return out;
}

export async function fetchGithubTrending(opts: {
  language?: string | null;
  since?: string | null;
  maxResults?: number;
}): Promise<TrendingResult> {
  const period = normalizeSince(opts.since);
  const lang = normalizeLanguage(opts.language);
  const limit = Math.max(1, Math.min(opts.maxResults ?? 10, 25));
  const path = lang ? `/trending/${lang}` : "/trending";
  const url = `https://github.com${path}?since=${encodeURIComponent(period)}`;
  const cacheKey = `${period}:${lang || "any"}:${limit}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() < hit.expires) {
    return { ...hit.payload, cached: true };
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; brief-desk)",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!res.ok) {
    return {
      source: "github_trending",
      url,
      language: opts.language || null,
      since: period,
      repos: [],
      cached: false,
      error: `trending fetch failed (${res.status})`,
      guidance: "Retry later, or redeploy MCP to 0.10.0+ for brief_github_trending.",
    };
  }

  const html = await res.text();
  const repos = parseTrendingHtml(html, limit);
  const payload: TrendingResult = {
    source: "github_trending",
    url,
    language: opts.language || null,
    since: period,
    repos,
    cached: false,
    ...(repos.length
      ? {}
      : {
          error: "no repos parsed",
          guidance: "GitHub HTML may have changed, or try a different language/window.",
        }),
  };
  cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, payload });
  return payload;
}

export function isMcpToolMissing(error?: string): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return (
    e.includes("not found") ||
    e.includes("-32602") ||
    e.includes("unknown tool") ||
    e.includes("tool does not exist")
  );
}
