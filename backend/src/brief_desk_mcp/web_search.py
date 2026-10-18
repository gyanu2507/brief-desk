"""Free web search via DuckDuckGo Instant Answer API (no API key)."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote_plus

import httpx

from brief_desk_mcp.github_tools import truncate

FETCH_TIMEOUT = 12.0


def _flatten_related(topics: list[Any], limit: int = 6) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in topics:
        if len(out) >= limit:
            break
        if not isinstance(item, dict):
            continue
        if "Topics" in item and isinstance(item["Topics"], list):
            out.extend(_flatten_related(item["Topics"], limit - len(out)))
            continue
        text = (item.get("Text") or "").strip()
        url = (item.get("FirstURL") or "").strip()
        if text:
            out.append({"title": text[:160], "url": url, "snippet": text[:400]})
    return out


async def search_web(query: str, max_results: int = 6) -> dict[str, Any]:
    q = (query or "").strip()
    if len(q) < 2:
        return {"query": q, "hits": [], "error": "query too short"}

    params = {
        "q": q,
        "format": "json",
        "no_html": "1",
        "skip_disambig": "1",
    }
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
        res = await client.get(
            "https://api.duckduckgo.com/",
            params=params,
            headers={"User-Agent": "brief-desk-mcp"},
        )
    if res.status_code >= 400:
        return {
            "query": q,
            "hits": [],
            "error": f"search failed ({res.status_code})",
            "guidance": "Retry later or pass a direct https URL to brief_fetch_url.",
        }

    data = res.json()
    hits: list[dict[str, str]] = []
    abstract = (data.get("AbstractText") or "").strip()
    abstract_url = (data.get("AbstractURL") or "").strip()
    if abstract:
        hits.append(
            {
                "title": (data.get("Heading") or "Summary")[:160],
                "url": abstract_url,
                "snippet": truncate(abstract, 500),
            }
        )
    hits.extend(_flatten_related(data.get("RelatedTopics") or [], max_results))
    hits = hits[:max_results]

    return {
        "query": q,
        "hits": hits,
        "answer": (data.get("Answer") or "").strip() or None,
        "source": "duckduckgo_instant_answer",
        "search_url": f"https://duckduckgo.com/?q={quote_plus(q)}",
        "guidance": (
            "Cite hit URLs in the brief. Instant Answer is sparse for some queries; "
            "combine with GitHub/docs tools when needed."
            if hits
            else "No Instant Answer hits. Try a more specific query or a docs URL."
        ),
    }
