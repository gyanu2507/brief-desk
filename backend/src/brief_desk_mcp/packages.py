"""Public package registry lookups (npm + PyPI). No API keys."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from brief_desk_mcp.github_tools import FETCH_TIMEOUT_MS, truncate

TIMEOUT = max(FETCH_TIMEOUT_MS / 1000.0, 10.0)


async def lookup_npm(name: str) -> dict[str, Any]:
    raw = (name or "").strip()
    if len(raw) < 1:
        return {"registry": "npm", "error": "package name required", "package": raw}

    # Keep scoped names: @scope/name
    pkg = raw.replace(" ", "")
    if not pkg:
        return {"registry": "npm", "error": "package name required", "package": raw}

    # Scoped packages must be path-encoded (@scope%2Fname).
    url = f"https://registry.npmjs.org/{quote(pkg, safe='')}"
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        res = await client.get(url, headers={"User-Agent": "brief-desk-mcp", "Accept": "application/json"})
    if res.status_code == 404:
        return {
            "registry": "npm",
            "package": pkg,
            "error": "not found",
            "guidance": "Check the name (scoped packages need @scope/name).",
        }
    if res.status_code >= 400:
        return {
            "registry": "npm",
            "package": pkg,
            "error": f"npm registry failed ({res.status_code})",
        }

    data = res.json()
    latest = (data.get("dist-tags") or {}).get("latest")
    versions = data.get("versions") or {}
    ver = versions.get(latest) if isinstance(versions, dict) and latest else None
    repo = None
    if isinstance(ver, dict):
        r = ver.get("repository")
        if isinstance(r, dict):
            repo = r.get("url")
        elif isinstance(r, str):
            repo = r
        homepage = ver.get("homepage")
        license_ = ver.get("license")
        description = ver.get("description") or data.get("description")
        deps = list((ver.get("dependencies") or {}).keys())[:20]
    else:
        homepage = data.get("homepage")
        license_ = None
        description = data.get("description")
        deps = []

    time_map = data.get("time") or {}
    return {
        "registry": "npm",
        "package": data.get("name") or pkg,
        "description": truncate(description or "", 280) or None,
        "latest": latest,
        "license": license_,
        "homepage": homepage,
        "repository": repo,
        "published_at": time_map.get(latest) if isinstance(time_map, dict) else None,
        "weekly_downloads_hint": f"https://www.npmjs.com/package/{pkg}",
        "dependencies": deps,
        "guidance": (
            "Cite npm URL + version. For deeper code context, map repository → brief_repo_overview."
        ),
    }


async def lookup_pypi(name: str) -> dict[str, Any]:
    pkg = (name or "").strip().lower()
    if len(pkg) < 1:
        return {"registry": "pypi", "error": "package name required", "package": name}

    url = f"https://pypi.org/pypi/{pkg}/json"
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        res = await client.get(url, headers={"User-Agent": "brief-desk-mcp", "Accept": "application/json"})
    if res.status_code == 404:
        return {
            "registry": "pypi",
            "package": pkg,
            "error": "not found",
            "guidance": "Check the PyPI project name.",
        }
    if res.status_code >= 400:
        return {
            "registry": "pypi",
            "package": pkg,
            "error": f"PyPI failed ({res.status_code})",
        }

    data = res.json()
    info = data.get("info") or {}
    urls = info.get("project_urls") or {}
    requires = info.get("requires_dist") or []
    if isinstance(requires, list):
        requires = [str(x) for x in requires[:20]]
    else:
        requires = []

    return {
        "registry": "pypi",
        "package": info.get("name") or pkg,
        "description": truncate((info.get("summary") or ""), 280) or None,
        "latest": info.get("version"),
        "license": info.get("license"),
        "home_page": info.get("home_page") or urls.get("Homepage"),
        "project_url": info.get("project_url") or f"https://pypi.org/project/{pkg}/",
        "repository": urls.get("Source") or urls.get("Repository") or urls.get("Code"),
        "requires_python": info.get("requires_python"),
        "requires_dist": requires,
        "guidance": (
            "Cite PyPI URL + version. If repository is a GitHub URL, follow with brief_repo_overview."
        ),
    }


async def diff_repo_releases(repo: str, tag_a: str, tag_b: str) -> dict[str, Any]:
    """Compare two release notes for the same repo (by tag)."""
    from brief_desk_mcp.discover import fetch_repo_releases

    pack = await fetch_repo_releases(repo, max_results=30)
    releases = pack.get("releases") or []
    by_tag = {
        (r.get("tag") or "").lstrip("v"): r
        for r in releases
        if isinstance(r, dict) and r.get("tag")
    }
    # Also index with original tag spelling
    for r in releases:
        if isinstance(r, dict) and r.get("tag"):
            by_tag[str(r["tag"])] = r

    a = by_tag.get(tag_a) or by_tag.get(tag_a.lstrip("v"))
    b = by_tag.get(tag_b) or by_tag.get(tag_b.lstrip("v"))
    if not a or not b:
        return {
            "repo": repo,
            "tag_a": tag_a,
            "tag_b": tag_b,
            "error": "one or both tags not found in recent releases",
            "available_tags": [r.get("tag") for r in releases[:12] if isinstance(r, dict)],
            "guidance": "Call brief_repo_releases first and pick two tags from the list.",
        }

    return {
        "repo": repo,
        "from": {
            "tag": a.get("tag"),
            "name": a.get("name"),
            "published_at": a.get("published_at"),
            "url": a.get("url"),
            "notes": a.get("notes"),
        },
        "to": {
            "tag": b.get("tag"),
            "name": b.get("name"),
            "published_at": b.get("published_at"),
            "url": b.get("url"),
            "notes": b.get("notes"),
        },
        "guidance": (
            "Write a changelog-style delta: breaking changes, features, fixes. Cite both release URLs."
        ),
    }
