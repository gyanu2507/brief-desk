from __future__ import annotations

import json
from typing import Any

import re

from brief_desk_mcp.corpus import search_corpus
from brief_desk_mcp.discover import (
    fetch_repo_releases,
    fetch_repo_security,
    fetch_trending,
    search_github_repos,
)
from brief_desk_mcp.packages import lookup_npm, lookup_pypi
from brief_desk_mcp.github_tools import (
    fetch_public_url,
    fetch_repo_ask,
    fetch_repo_overview,
    truncate,
)
from brief_desk_mcp.plan import (
    build_autonomous_plan,
    classify_brief_mode,
    normalize_github_repo,
    plan_for_mode,
)
from brief_desk_mcp.web_search import search_web


async def run_orchestrate(
    *,
    question: str,
    repo: str | None = None,
    repo_b: str | None = None,
    url: str | None = None,
    mode: str | None = None,
) -> str:
    mode_v = mode or classify_brief_mode(question)
    repo_n = normalize_github_repo(repo)
    repo_b_n = normalize_github_repo(repo_b)
    url_v = (url or "").strip() or None
    plan = plan_for_mode(mode_v, bool(repo_n), bool(url_v))
    stages: dict[str, Any] = {"plan": plan, "mode": mode_v}

    if mode_v == "compare":
        if not repo_n or not repo_b_n:
            return json.dumps(
                {
                    "plan": plan,
                    "mode": mode_v,
                    "error": "compare mode needs repo and repo_b (owner/name)",
                    "next": "Ask the user for both repositories, then call brief_orchestrate again.",
                },
                indent=2,
            )
        a = json.loads(await fetch_repo_overview(repo_n))
        b = json.loads(await fetch_repo_overview(repo_b_n))
        stages["gather"] = {"a": a, "b": b}
        stages["guidance"] = (
            "Write a side-by-side comparison (purpose, stack, maturity, when to pick which). "
            "Cite README facts. Then call brief_eval on your draft."
        )
    elif url_v:
        stages["gather"] = {"url": await fetch_public_url(url_v)}
        if repo_n:
            stages["gather"] = {
                **stages["gather"],
                "repo": json.loads(await fetch_repo_overview(repo_n)),
            }
        stages["guidance"] = (
            "Answer using the URL text (and repo pack if present). Cite the URL. "
            "Then call brief_eval on your draft."
        )
    elif repo_n:
        if mode_v == "overview":
            stages["gather"] = json.loads(await fetch_repo_overview(repo_n))
        elif mode_v == "docs":
            stages["gather"] = {
                "overview": json.loads(await fetch_repo_overview(repo_n)),
                "hint": "If the user wants local docs only, also call brief_corpus.",
            }
        elif mode_v == "risks":
            ask = json.loads(await fetch_repo_ask(repo_n, question))
            stages["gather"] = {
                "ask": ask,
                "security": await fetch_repo_security(repo_n),
                "releases": await fetch_repo_releases(repo_n, max_results=3),
            }
        elif mode_v == "activity":
            ask = json.loads(await fetch_repo_ask(repo_n, question))
            stages["gather"] = {
                "ask": ask,
                "releases": await fetch_repo_releases(repo_n, max_results=5),
            }
        else:
            stages["gather"] = json.loads(await fetch_repo_ask(repo_n, question))
        stages["guidance"] = (
            "Answer from gather only. Cite paths and #issue/#PR numbers. "
            "Then call brief_eval with question, draft, and a short evidence excerpt."
        )
    else:
        stages["gather"] = search_corpus(question)
        stages["guidance"] = (
            "No repo/url was given, so the bundled local corpus was searched. "
            "Answer from hits or ask for owner/name / URL. Then brief_eval."
        )

    text = json.dumps(stages, indent=2)
    if len(text) > 14000:
        text = truncate(text, 14000)
    return text


async def run_auto(goal: str) -> str:
    plan = build_autonomous_plan(goal)
    invented = plan["invented"]
    want_web = bool(re.search(r"\b(web|search|internet|online|news)\b", goal, re.I))
    kind = invented.get("source_kind")

    if kind == "trending":
        trending = await fetch_trending(
            language=invented.get("language"),
            since=invented.get("since") or "weekly",
            max_results=10,
        )
        packed = {
            **plan,
            "gather": {"trending": trending},
            "guidance": (
                "Draft a ranked shortlist from trending.repos. Cite the trending URL and each repo. "
                "Then brief_eval. Do not gather again."
            ),
        }
        return json.dumps(packed, indent=2)

    if kind == "package":
        gather_pkg: dict[str, Any] = {}
        if invented.get("npm_package"):
            gather_pkg["npm"] = await lookup_npm(str(invented["npm_package"]))
        if invented.get("pypi_package"):
            gather_pkg["pypi"] = await lookup_pypi(str(invented["pypi_package"]))
        if not gather_pkg:
            # Infer from goal text if invent missed the name.
            if re.search(r"\bnpm\b", goal, re.I):
                gather_pkg["npm"] = await lookup_npm(goal.split()[-1])
            else:
                gather_pkg["pypi"] = await lookup_pypi(goal.split()[-1])
        packed = {
            **plan,
            "gather": gather_pkg,
            "guidance": (
                "Draft a package brief from gather (version, license, deps, linked repo). "
                "Cite registry URL. Then brief_eval."
            ),
        }
        return json.dumps(packed, indent=2)

    if kind == "discover":
        search = await search_github_repos(
            goal,
            language=invented.get("language"),
            sort="stars",
            max_results=8,
        )
        packed = {
            **plan,
            "gather": {"search": search},
            "guidance": (
                "Draft a shortlist from search.repos (fit + stars + freshness). Cite repo URLs. "
                "Then brief_eval."
            ),
        }
        return json.dumps(packed, indent=2)

    if kind == "corpus" or (not invented["repo"] and not invented["url"]):
        gather: dict[str, Any] = {"corpus": search_corpus(goal)}
        if want_web or not gather["corpus"]["hits"]:
            gather["web"] = await search_web(goal)
        if want_web and "find" in goal.lower():
            gather["search"] = await search_github_repos(goal, max_results=5)
        hits = (
            gather["corpus"]["hits"]
            or (gather.get("web") or {}).get("hits")
            or (gather.get("search") or {}).get("repos")
            or []
        )
        packed = {
            **plan,
            "gather": gather,
            "guidance": (
                "Draft from gather (corpus and/or web/search), then brief_eval. Cite file paths or URLs."
                if hits
                else "No repo/URL and no corpus/web hits. Ask one clarifying question."
            ),
        }
        return json.dumps(packed, indent=2)

    gather_text = await run_orchestrate(
        question=goal,
        repo=invented.get("repo"),
        repo_b=invented.get("repo_b"),
        url=invented.get("url"),
        mode=invented.get("mode"),
    )
    try:
        gather_obj: Any = json.loads(gather_text)
    except json.JSONDecodeError:
        gather_obj = {"raw": truncate(gather_text, 8000)}

    if want_web and isinstance(gather_obj, dict):
        gather_obj["web"] = await search_web(goal)

    packed = {
        **plan,
        "gather": gather_obj,
        "guidance": (
            "Draft the user-facing brief NOW from gather only. Address each subgoal. "
            "Cite paths/#issue/URLs. Then call brief_eval. Do not gather again."
        ),
    }
    text = json.dumps(packed, indent=2)
    if len(text) > 14000:
        text = truncate(text, 14000)
    return text
