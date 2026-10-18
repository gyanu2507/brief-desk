from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

BriefMode = str


def normalize_github_repo(value: str | None) -> str | None:
    if not value:
        return None
    trimmed = value.strip()
    trimmed = re.sub(r"^https?://github\.com/", "", trimmed, flags=re.I)
    trimmed = re.sub(r"\.git$", "", trimmed)
    trimmed = trimmed.rstrip("/")
    return trimmed if REPO_RE.match(trimmed) else None


def classify_brief_mode(question: str) -> BriefMode:
    q = question.lower()
    if re.search(r"\b(compar|vs\.?|versus|diff(erence)? between)\b", q):
        return "compare"
    if re.search(r"\b(risks?|security|vulnerab|cve|threat|incident)\b", q):
        return "risks"
    if re.search(r"\b(architect|design|structure|module|component|how is it (built|organized))\b", q):
        return "architecture"
    if re.search(r"\b(issue|pr|pull request|landed|merged|changelog|release|activity)\b", q):
        return "activity"
    if re.search(r"\b(how does|where is|implement|code|source|function|api|endpoint)\b", q):
        return "code"
    if re.search(r"\b(doc|docs|documentation|guide|tutorial|readme|corpus)\b", q):
        return "docs"
    if re.search(r"\b(feature|overview|what is|what does|getting started|about)\b", q):
        return "overview"
    return "general"


def plan_for_mode(mode: BriefMode, has_repo: bool, has_url: bool) -> list[str]:
    steps = [f"plan:{mode}"]
    if mode == "compare":
        steps.extend(["gather:meta+readme for each repo", "synthesize:side-by-side", "eval:citations"])
        return steps
    if has_url:
        steps.append("gather:public_url")
    if has_repo:
        if mode == "overview":
            steps.extend(["gather:overview", "optional:root"])
        elif mode in ("activity", "risks"):
            steps.append("gather:issues+releases")
        elif mode == "architecture":
            steps.extend(["gather:overview+root", "optional:code"])
        elif mode == "code":
            steps.extend(["gather:ask(code)", "optional:file"])
        elif mode == "docs":
            steps.append("gather:url" if has_url else "gather:overview+corpus")
        else:
            steps.append("gather:ask(mixed)")
    elif not has_url:
        steps.append("gather:corpus_or_ask_for_repo_or_url")
    steps.extend(["draft:answer_from_evidence", "eval:rubric"])
    return steps


def build_autonomous_plan(goal: str) -> dict[str, Any]:
    urls = []
    for m in re.finditer(r"https?://[^\s)>\]]+", goal, flags=re.I):
        u = re.sub(r"[.,;]+$", "", m.group(0))
        try:
            p = urlparse(u)
            if p.scheme in ("http", "https"):
                urls.append(u)
        except Exception:
            continue

    from_links: list[str] = []
    for u in urls:
        m = re.search(r"github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)", u, flags=re.I)
        if m:
            r = normalize_github_repo(m.group(1))
            if r:
                from_links.append(r)

    from_slash: list[str] = []
    for m in re.finditer(r"\b([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\b", goal):
        r = normalize_github_repo(m.group(1))
        if not r:
            continue
        if any(r in u for u in urls):
            continue
        if "." in r.split("/")[0]:
            continue
        from_slash.append(r)

    repos = list(dict.fromkeys([*from_links, *from_slash]))
    docs_urls = [u for u in urls if "github.com/" not in u.lower()]
    mode = classify_brief_mode(goal)

    want_trending = bool(
        re.search(r"\b(trending|trend(ing)?\s+on\s+github|github\s+trending)\b", goal, flags=re.I)
    )
    want_repo_search = bool(
        re.search(
            r"\b(find|search|discover|shortlist|recommend)\b.*\b(repo|repos|repositories|libraries|frameworks)\b",
            goal,
            flags=re.I,
        )
    ) or bool(re.search(r"\b(best|top)\b.*\b(libraries|frameworks|repos?)\b", goal, flags=re.I))

    npm_pkg = None
    pypi_pkg = None
    npm_m = re.search(
        r"\bnpm\s+(?:package\s+)?(@?[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?)\b",
        goal,
        flags=re.I,
    ) or re.search(
        r"\b(?:package|pkg)\s+(@[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\b",
        goal,
        flags=re.I,
    )
    if npm_m:
        npm_pkg = npm_m.group(1)
    pypi_m = re.search(r"\bpypi\s+(?:package\s+)?([A-Za-z0-9_.-]+)\b", goal, flags=re.I)
    if pypi_m:
        pypi_pkg = pypi_m.group(1)
    want_package = bool(npm_pkg or pypi_pkg) or bool(
        re.search(r"\b(npm|pypi)\b.*\b(package|version|deps|dependencies)\b", goal, flags=re.I)
    )

    language = None
    lang_m = re.search(
        r"\b(typescript|javascript|python|rust|go|golang|java|kotlin|swift|ruby|php|c\+\+|c#|csharp|vue|svelte)\b",
        goal,
        flags=re.I,
    )
    if lang_m:
        language = lang_m.group(1).lower()
        if language == "golang":
            language = "go"
        if language == "csharp":
            language = "c#"
        if language == "c++":
            language = "c++"

    since = "weekly"
    if re.search(r"\b(today|daily)\b", goal, flags=re.I):
        since = "daily"
    elif re.search(r"\b(month(ly)?)\b", goal, flags=re.I):
        since = "monthly"

    source_kind = "auto"
    if mode == "compare" and len(repos) >= 2:
        source_kind = "compare"
    elif want_package and not repos:
        source_kind = "package"
    elif want_trending and not repos:
        source_kind = "trending"
    elif want_repo_search and not repos and not docs_urls:
        source_kind = "discover"
    elif docs_urls and not repos:
        source_kind = "url"
    elif repos:
        source_kind = "github"
    elif docs_urls:
        source_kind = "url"
    elif re.search(r"\b(corpus|sample docs|bundled)\b", goal, flags=re.I):
        source_kind = "corpus"

    subgoals: list[str] = []
    if source_kind == "compare" or (mode == "compare" and len(repos) >= 2):
        subgoals.append(f"Compare {repos[0]} vs {repos[1]} on purpose, stack, maturity")
        subgoals.append("Call out when to pick which")
    elif source_kind == "package":
        subgoals.extend(
            [
                f"Look up {'npm ' + npm_pkg if npm_pkg else 'PyPI ' + (pypi_pkg or 'package')}",
                "Summarize latest version, license, deps, and linked repo",
            ]
        )
    elif source_kind == "trending":
        subgoals.extend(
            [
                f"List trending GitHub repos ({language or 'any'}, {since})",
                "Rank a shortlist with why each matters; cite trending + repo URLs",
            ]
        )
    elif source_kind == "discover":
        subgoals.extend(
            [
                "Search GitHub for matching repositories",
                "Shortlist by stars/freshness/fit; cite repo URLs",
            ]
        )
    elif mode == "risks":
        subgoals.extend(
            [
                "Surface open issues / security advisories",
                "Rank top risks with citations",
            ]
        )
    elif mode == "architecture":
        subgoals.extend(["Map modules and entry points", "Explain how the core flow fits together"])
    elif docs_urls:
        subgoals.extend(
            ["Extract engineer-relevant concepts from the URL", "List actionable next steps"]
        )
    elif source_kind == "corpus":
        subgoals.extend(["Search the bundled corpus", "Answer only from local hits"])
    else:
        subgoals.extend(
            ["Produce a concise engineering brief", "Cite paths, issues, or URLs from evidence"]
        )

    if source_kind == "corpus":
        tool_steps = ["brief_auto (or brief_corpus)", "draft from evidence", "brief_eval"]
    elif source_kind == "package":
        tool_steps = [
            "brief_npm_package or brief_pypi_package",
            "optional: brief_repo_overview if repository is GitHub",
            "draft + brief_eval",
        ]
    elif source_kind == "trending":
        tool_steps = [
            "brief_github_trending",
            "draft shortlist from repos",
            "brief_eval",
        ]
    elif source_kind == "discover":
        tool_steps = [
            "brief_github_search",
            "draft shortlist from repos",
            "brief_eval",
        ]
    elif repos or docs_urls:
        tool_steps = [
            "brief_auto once (plan+gather)",
            "draft from gather only — no more gather tools",
            "brief_eval",
            "revise once if pass=false",
        ]
    else:
        tool_steps = [
            "ask user for owner/name or public URL if goal is too vague",
            "or brief_github_trending / brief_github_search / brief_corpus",
        ]

    return {
        "goal": goal,
        "invented": {
            "source_kind": source_kind,
            "mode": mode,
            "repo": repos[0] if repos else None,
            "repo_b": repos[1] if len(repos) > 1 else None,
            "url": docs_urls[0] if docs_urls else None,
            "language": language,
            "since": since if source_kind == "trending" else None,
            "npm_package": npm_pkg,
            "pypi_package": pypi_pkg,
            "subgoals": subgoals,
        },
        "tool_steps": tool_steps,
        "success": [
            "Answer grounded in tool evidence",
            "Citations present (paths, #issue/#PR, or URLs)",
            "brief_eval pass=true (or one revision applied)",
        ],
        "next": (
            "Execute tool_steps now. Do not wait for the user to fill the left panel."
            if repos
            or docs_urls
            or source_kind in ("corpus", "trending", "discover", "package")
            else "Goal has no extractable repo/URL. Ask one clarifying question or use discover/trending/package/corpus tools."
        ),
    }
