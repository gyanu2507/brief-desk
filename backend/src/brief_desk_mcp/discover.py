"""Discovery tools: GitHub trending, repo search, releases, security advisories."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from brief_desk_mcp.github_tools import FETCH_TIMEOUT_MS, github_json, truncate

TRENDING_TTL_NOTE = "Live scrape of github.com/trending (no official API)."
SINCE_MAP = {"daily": "daily", "week": "weekly", "weekly": "weekly", "month": "monthly", "monthly": "monthly"}


def _normalize_since(since: str | None) -> str:
    key = (since or "weekly").strip().lower()
    return SINCE_MAP.get(key, "weekly")


def _normalize_language(language: str | None) -> str | None:
    if not language:
        return None
    lang = language.strip().lower().replace(" ", "-")
    if lang in ("any", "all", "*"):
        return None
    # GitHub trending path uses slug form (typescript, javascript, c%23 → c%23)
    return quote(lang, safe="")


def _parse_trending_html(html: str, limit: int) -> list[dict[str, Any]]:
    articles = re.findall(
        r'<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>(.*?)</article>',
        html,
        flags=re.I | re.S,
    )
    out: list[dict[str, Any]] = []
    for block in articles:
        if len(out) >= limit:
            break
        m = re.search(r'<h2[^>]*>\s*<a[^>]+href="/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)"', block)
        if not m:
            m = re.search(r'href="/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)"', block)
        if not m:
            continue
        repo = m.group(1)
        if repo.startswith("sponsors/") or repo.startswith("login"):
            continue
        desc_m = re.search(r"<p[^>]*>(.*?)</p>", block, flags=re.I | re.S)
        desc = ""
        if desc_m:
            desc = re.sub(r"<[^>]+>", "", desc_m.group(1))
            desc = re.sub(r"\s+", " ", desc).strip()
        stars_m = re.search(
            r"([\d,]+)\s+stars?\s+(today|this week|this month)",
            block,
            flags=re.I,
        )
        lang_m = re.search(
            r'itemprop="programmingLanguage"[^>]*>\s*([^<]+)',
            block,
            flags=re.I,
        )
        out.append(
            {
                "repo": repo,
                "url": f"https://github.com/{repo}",
                "description": truncate(desc, 240) if desc else None,
                "stars_delta": stars_m.group(1).replace(",", "") if stars_m else None,
                "stars_period": stars_m.group(2).lower() if stars_m else None,
                "language": (lang_m.group(1).strip() if lang_m else None),
            }
        )
    return out


async def fetch_trending(
    *,
    language: str | None = None,
    since: str | None = "weekly",
    max_results: int = 10,
) -> dict[str, Any]:
    period = _normalize_since(since)
    lang = _normalize_language(language)
    limit = max(1, min(max_results, 25))
    path = f"/trending/{lang}" if lang else "/trending"
    url = f"https://github.com{path}?{urlencode({'since': period})}"

    timeout = max(FETCH_TIMEOUT_MS / 1000.0, 12.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        res = await client.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; brief-desk-mcp)",
                "Accept": "text/html",
            },
        )
    if res.status_code >= 400:
        return {
            "source": "github_trending",
            "url": url,
            "language": language,
            "since": period,
            "repos": [],
            "error": f"trending fetch failed ({res.status_code})",
            "guidance": "Retry later, or use brief_github_search as a stars/created fallback.",
        }

    repos = _parse_trending_html(res.text, limit)
    return {
        "source": "github_trending",
        "url": url,
        "language": language or "any",
        "since": period,
        "count": len(repos),
        "repos": repos,
        "note": TRENDING_TTL_NOTE,
        "guidance": (
            "Rank or shortlist from repos[]. Cite github.com/trending and each repo URL. "
            "For a deeper brief on one pick, call brief_repo_overview or brief_repo_ask."
            if repos
            else "No repos parsed. Try another language/since or brief_github_search."
        ),
    }


async def search_github_repos(
    query: str,
    *,
    language: str | None = None,
    sort: str = "stars",
    max_results: int = 8,
) -> dict[str, Any]:
    q = (query or "").strip()
    if len(q) < 2:
        return {"query": q, "repos": [], "error": "query too short"}

    parts = [q]
    if language and language.strip().lower() not in ("any", "all", "*"):
        parts.append(f"language:{language.strip()}")
    q_full = " ".join(parts)
    limit = max(1, min(max_results, 20))
    sort_v = sort if sort in ("stars", "forks", "updated", "best-match") else "stars"
    params = f"q={quote(q_full)}&order=desc&per_page={limit}"
    if sort_v != "best-match":
        params += f"&sort={quote(sort_v)}"
    path = f"/search/repositories?{params}"

    ok, data, status, err = await github_json(path)
    if not ok or not isinstance(data, dict):
        return {
            "query": q_full,
            "repos": [],
            "error": f"search failed ({status}): {err or 'bad response'}",
            "guidance": "Set GITHUB_TOKEN on the MCP host if you hit rate limits.",
        }

    repos = []
    for it in (data.get("items") or [])[:limit]:
        if not isinstance(it, dict):
            continue
        full = it.get("full_name")
        if not isinstance(full, str):
            continue
        repos.append(
            {
                "repo": full,
                "url": it.get("html_url") or f"https://github.com/{full}",
                "description": truncate((it.get("description") or ""), 240) or None,
                "stars": it.get("stargazers_count"),
                "forks": it.get("forks_count"),
                "language": it.get("language"),
                "updated_at": it.get("updated_at"),
                "topics": (it.get("topics") or [])[:8],
            }
        )

    return {
        "source": "github_search",
        "query": q_full,
        "sort": sort_v,
        "count": len(repos),
        "total_count": data.get("total_count"),
        "repos": repos,
        "guidance": (
            "Shortlist with stars/updated/topics. Cite repo URLs. "
            "Drill into one with brief_repo_overview / brief_repo_ask / brief_repo_releases."
            if repos
            else "No hits. Broaden the query or try brief_github_trending."
        ),
    }


async def search_repos_recent_stars(
    *,
    language: str | None = None,
    days: int = 7,
    max_results: int = 8,
) -> dict[str, Any]:
    """Fallback when trending HTML is empty: repos created recently, sorted by stars."""
    days_n = max(1, min(days, 90))
    since = (datetime.now(timezone.utc) - timedelta(days=days_n)).strftime("%Y-%m-%d")
    bits = [f"created:>{since}", "stars:>10"]
    if language and language.strip().lower() not in ("any", "all", "*"):
        bits.append(f"language:{language.strip()}")
    return await search_github_repos(
        " ".join(bits),
        sort="stars",
        max_results=max_results,
    )


async def fetch_repo_releases(repo: str, max_results: int = 5) -> dict[str, Any]:
    target = repo.strip()
    limit = max(1, min(max_results, 15))
    ok, data, status, err = await github_json(f"/repos/{target}/releases?per_page={limit}")
    if not ok:
        return {
            "repo": target,
            "releases": [],
            "error": f"releases failed ({status}): {err or 'bad response'}",
        }
    if not isinstance(data, list):
        return {"repo": target, "releases": [], "error": "unexpected releases payload"}

    releases = []
    for it in data[:limit]:
        if not isinstance(it, dict) or it.get("draft"):
            continue
        body = (it.get("body") or "").strip()
        releases.append(
            {
                "tag": it.get("tag_name"),
                "name": it.get("name"),
                "published_at": it.get("published_at"),
                "prerelease": bool(it.get("prerelease")),
                "url": it.get("html_url"),
                "notes": truncate(body, 600) if body else None,
            }
        )
    return {
        "repo": target,
        "count": len(releases),
        "releases": releases,
        "guidance": (
            "Cite tag + release URL. Summarize breaking changes from notes."
            if releases
            else "No published releases. Check tags via brief_repo_ask activity mode."
        ),
    }


async def fetch_repo_security(repo: str, max_results: int = 8) -> dict[str, Any]:
    """Open GitHub Security Advisories for a repo (public API)."""
    target = repo.strip()
    limit = max(1, min(max_results, 20))
    # Repository advisories endpoint
    ok, data, status, err = await github_json(
        f"/repos/{target}/security-advisories?per_page={limit}&state=published"
    )
    advisories: list[dict[str, Any]] = []
    advisory_error = None
    if ok and isinstance(data, list):
        for it in data[:limit]:
            if not isinstance(it, dict):
                continue
            advisories.append(
                {
                    "ghsa_id": it.get("ghsa_id"),
                    "cve_id": it.get("cve_id"),
                    "summary": truncate((it.get("summary") or ""), 200),
                    "severity": it.get("severity"),
                    "published_at": it.get("published_at"),
                    "html_url": it.get("html_url"),
                }
            )
    else:
        advisory_error = f"advisories ({status}): {err or 'unavailable'}"

    # Dependabot alerts need repo security_events scope; skip and note.
    return {
        "repo": target,
        "advisories": advisories,
        "count": len(advisories),
        "error": advisory_error,
        "note": (
            "Published repository advisories only. Private Dependabot alerts need a "
            "token with security scope and are not fetched here."
        ),
        "guidance": (
            "Cite GHSA/CVE URLs. Pair with brief_repo_ask risks mode for open issues."
            if advisories
            else "No published advisories (or API blocked). Still run brief_repo_ask for issue risks."
        ),
    }
