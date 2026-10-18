from __future__ import annotations

import base64
import os
import re
import time
from typing import Any
from urllib.parse import quote, urlparse

import httpx

FETCH_TIMEOUT_MS = float(os.environ.get("BRIEF_FETCH_TIMEOUT_MS", "10000"))
META_TTL_MS = 60_000
README_TTL_MS = 60_000

_cache: dict[str, tuple[float, Any]] = {}


def truncate(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return f"{text[:max_len]}\n\n…[truncated]"


def _cache_get(key: str) -> Any | None:
    hit = _cache.get(key)
    if not hit:
        return None
    expires, value = hit
    if time.time() * 1000 > expires:
        _cache.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any, ttl_ms: int) -> None:
    _cache[key] = (time.time() * 1000 + ttl_ms, value)
    if len(_cache) > 200:
        _cache.pop(next(iter(_cache)), None)


def search_terms(question: str) -> str:
    cleaned = re.sub(r"https?://github\.com/[^\s]+", " ", question, flags=re.I)
    cleaned = re.sub(r"[^\w\s./+-]", " ", cleaned)
    stop = {
        "the",
        "and",
        "for",
        "with",
        "what",
        "how",
        "are",
        "this",
        "that",
        "from",
        "about",
        "repo",
        "github",
        "all",
        "main",
    }
    words = [w for w in cleaned.split() if len(w) > 2 and w.lower() not in stop]
    return " ".join(words[:8])


def classify_ask_intent(question: str) -> str:
    q = question.lower()
    overview = bool(
        re.search(
            r"\b(feature|features|overview|what is|what does|readme|getting started|about this|describe|summary of the (repo|project))\b",
            q,
        )
    )
    activity = bool(
        re.search(
            r"\b(issue|issues|pr|prs|pull request|bug|risk|risks|landed|merged|open|activity|changelog|release)\b",
            q,
        )
    )
    code = bool(
        re.search(
            r"\b(how does|where is|implement|implemented|code|source|function|class|file|path|api|endpoint|config)\b",
            q,
        )
    )
    if overview and not activity and not code:
        return "overview"
    if activity and not code and not overview:
        return "activity"
    if code and not activity:
        return "code"
    if overview and activity and not code:
        return "activity"
    return "mixed"


async def github_json(path: str, accept: str | None = None) -> tuple[bool, Any, int, str]:
    headers = {
        "Accept": accept or "application/vnd.github+json",
        "User-Agent": "brief-desk-mcp",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    timeout = FETCH_TIMEOUT_MS / 1000.0
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        res = await client.get(f"https://api.github.com{path}", headers=headers)
    if res.status_code >= 400:
        return False, None, res.status_code, truncate(res.text, 400)
    try:
        data = res.json()
    except Exception:
        return False, None, res.status_code, truncate(res.text, 400)
    return True, data, res.status_code, ""


async def decode_content_file(path: str, repo: str) -> dict[str, str] | None:
    ok, data, _, _ = await github_json(f"/repos/{repo}/contents/{quote(path, safe='/')}")
    if not ok or not isinstance(data, dict):
        return None
    if data.get("type") != "file" or data.get("encoding") != "base64" or not data.get("content"):
        return None
    if (data.get("size") or 0) > 200_000:
        return {"path": data.get("path") or path, "text": "[file too large to inline]"}
    raw = base64.b64decode(data["content"].replace("\n", "")).decode("utf-8", errors="replace")
    return {"path": data.get("path") or path, "text": truncate(raw, 1800)}


async def fetch_repo_meta(repo: str) -> dict[str, Any]:
    cached = _cache_get(f"meta:{repo}")
    if cached is not None:
        return cached
    ok, data, status, err = await github_json(f"/repos/{repo}")
    if not ok:
        raise RuntimeError(f"repo lookup failed ({status}): {err}")
    _cache_set(f"meta:{repo}", data, META_TTL_MS)
    return data


async def fetch_readme(repo: str, max_chars: int = 3500) -> str:
    key = f"readme:{repo}:{max_chars}"
    cached = _cache_get(key)
    if cached is not None:
        return cached
    ok, data, status, _ = await github_json(f"/repos/{repo}/readme")
    if not ok:
        text = "" if status == 404 else f"[readme error {status}]"
        _cache_set(key, text, README_TTL_MS)
        return text
    if not isinstance(data, dict) or data.get("encoding") != "base64" or not data.get("content"):
        _cache_set(key, "", README_TTL_MS)
        return ""
    text = truncate(
        base64.b64decode(data["content"].replace("\n", "")).decode("utf-8", errors="replace"),
        max_chars,
    )
    _cache_set(key, text, README_TTL_MS)
    return text


async def fetch_issue_hits(repo: str, question: str) -> dict[str, Any]:
    q = quote(f"{search_terms(question) or 'is:issue'} repo:{repo}")
    ok, data, status, err = await github_json(f"/search/issues?q={q}&per_page=5")
    if not ok or not isinstance(data, dict):
        return {"error": f"{status}: {err or 'bad response'}", "items": []}
    items = []
    for it in data.get("items") or []:
        items.append(
            {
                "number": it.get("number"),
                "title": it.get("title"),
                "state": it.get("state"),
                "kind": "pr" if it.get("pull_request") else "issue",
                "url": it.get("html_url"),
                "body": truncate((it.get("body") or "").replace("\r", ""), 180),
            }
        )
    return {"items": items}


async def fetch_code_hits(repo: str, question: str) -> dict[str, Any]:
    terms = search_terms(question)
    if not terms:
        return {"items": [], "note": "no search terms"}
    q = quote(f"{terms} repo:{repo}")
    ok, data, status, err = await github_json(f"/search/code?q={q}&per_page=4")
    if not ok or not isinstance(data, dict):
        return {
            "error": f"{status}: {err or 'bad response'}",
            "note": (
                "Code search needs GITHUB_TOKEN on the MCP host."
                if status in (401, 403)
                else None
            ),
            "items": [],
        }
    files = []
    for hit in (data.get("items") or [])[:2]:
        path = hit.get("path")
        if not path:
            continue
        file = await decode_content_file(path, repo)
        fragments = hit.get("text_matches") or []
        first = fragments[0] if fragments and isinstance(fragments[0], dict) else {}
        files.append(
            {
                "path": path,
                "url": hit.get("html_url"),
                "fragment": truncate(first.get("fragment") or "", 240),
                "preview": file.get("text") if file else None,
            }
        )
    return {"items": files}


async def fetch_root_listing(repo: str, branch: str) -> dict[str, Any]:
    ok, data, status, err = await github_json(
        f"/repos/{repo}/contents?ref={quote(branch)}"
    )
    if not ok or not isinstance(data, list):
        return {"error": f"{status}: {err or 'bad response'}", "entries": []}
    entries = [
        {"name": e.get("name"), "path": e.get("path"), "type": e.get("type")}
        for e in data[:20]
        if isinstance(e, dict)
    ]
    return {"entries": entries}


async def fetch_releases(repo: str) -> dict[str, Any]:
    ok, data, status, err = await github_json(f"/repos/{repo}/releases?per_page=5")
    if not ok or not isinstance(data, list):
        return {"error": f"{status}: {err or 'bad response'}", "items": []}
    items = [
        {
            "tag": r.get("tag_name"),
            "name": r.get("name"),
            "url": r.get("html_url"),
            "prerelease": r.get("prerelease"),
            "published_at": r.get("published_at"),
        }
        for r in data
        if isinstance(r, dict)
    ]
    return {"items": items}


async def fetch_repo_ask(repo: str, question: str) -> str:
    import json

    intent = classify_ask_intent(question)
    meta = await fetch_repo_meta(repo)
    branch = meta.get("default_branch") or "main"
    want_readme = intent in ("overview", "mixed", "code")
    want_root = intent in ("overview", "mixed", "code")
    want_issues = intent in ("activity", "mixed")
    want_code = intent == "code"
    want_releases = intent in ("activity", "mixed", "overview")
    readme_max = 2800 if intent == "overview" else (1400 if intent == "code" else 1600)

    readme = await fetch_readme(repo, readme_max) if want_readme else ""
    issues = await fetch_issue_hits(repo, question) if want_issues else {"items": [], "skipped": True}
    code = await fetch_code_hits(repo, question) if want_code else {"items": [], "skipped": True}
    root = await fetch_root_listing(repo, branch) if want_root else {"entries": [], "skipped": True}
    releases = await fetch_releases(repo) if want_releases else {"items": [], "skipped": True}

    pack: dict[str, Any] = {
        "question": question,
        "intent": intent,
        "repo": meta.get("full_name") or repo,
        "url": meta.get("html_url") or f"https://github.com/{repo}",
        "description": meta.get("description") or "",
        "homepage": meta.get("homepage") or "",
        "topics": meta.get("topics") or [],
        "language": meta.get("language") or "",
        "stars": meta.get("stargazers_count") or 0,
        "open_issues": meta.get("open_issues_count") or 0,
        "license": (
            (meta.get("license") or {}).get("spdx_id")
            if isinstance(meta.get("license"), dict)
            else ""
        )
        or "",
        "default_branch": branch,
        "guidance": (
            "Answer using this evidence. Cite file paths, issue/PR numbers, and README sections. "
            "If something is missing, say what was not found."
        ),
    }
    if want_readme:
        pack["readme"] = readme
    if want_root:
        pack["root"] = root
    if want_issues:
        pack["issues_and_prs"] = issues
    if want_code:
        pack["code"] = code
    if want_releases:
        pack["releases"] = releases
    if not want_code and intent == "overview":
        pack["note"] = (
            "Overview pack (no code search). Use brief_repo_ask with a code question "
            "or brief_repo_file for paths."
        )

    text = json.dumps(pack, indent=2)
    if len(text) > 14000 and want_readme:
        pack["readme"] = truncate(readme if isinstance(readme, str) else "", 1400)
        if want_code:
            pack["code"] = {"note": "omitted to fit model limit; use brief_repo_file"}
        text = json.dumps(pack, indent=2)
    if len(text) > 14000:
        text = truncate(text, 14000)
    return text


async def fetch_repo_overview(repo: str) -> str:
    import json

    meta = await fetch_repo_meta(repo)
    readme = await fetch_readme(repo)
    return json.dumps(
        {
            "repo": meta.get("full_name") or repo,
            "url": meta.get("html_url") or f"https://github.com/{repo}",
            "description": meta.get("description") or "",
            "homepage": meta.get("homepage") or "",
            "topics": meta.get("topics") or [],
            "language": meta.get("language") or "",
            "stars": meta.get("stargazers_count") or 0,
            "default_branch": meta.get("default_branch") or "main",
            "readme": readme,
        },
        indent=2,
    )


async def fetch_public_url(url: str) -> dict[str, Any]:
    try:
        parsed = urlparse(url)
    except Exception as e:
        raise RuntimeError("invalid URL") from e
    if parsed.scheme not in ("http", "https"):
        raise RuntimeError("only http/https URLs are allowed")
    host = (parsed.hostname or "").lower()
    if host in {"localhost", "127.0.0.1", "0.0.0.0"} or host.endswith(".local"):
        raise RuntimeError("local URLs are blocked")
    timeout = FETCH_TIMEOUT_MS / 1000.0
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        res = await client.get(
            parsed.geturl(),
            headers={
                "User-Agent": "brief-desk-mcp",
                "Accept": "text/plain, text/markdown, text/html, */*",
            },
        )
    if res.status_code >= 400:
        raise RuntimeError(f"fetch failed ({res.status_code})")
    ctype = res.headers.get("content-type") or ""
    raw = res.text
    if "html" in ctype or re.search(r"<html[\s>]", raw, re.I):
        raw = re.sub(r"<script[\s\S]*?</script>", " ", raw, flags=re.I)
        raw = re.sub(r"<style[\s\S]*?</style>", " ", raw, flags=re.I)
        raw = re.sub(r"<[^>]+>", " ", raw)
        raw = re.sub(r"\s+", " ", raw).strip()
    return {
        "url": parsed.geturl(),
        "text": truncate(raw, 6000),
        "note": "html_stripped" if "html" in ctype else None,
    }
