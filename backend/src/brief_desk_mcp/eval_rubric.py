from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

_URL_RE = re.compile(r"https?://[^\s)\]>'\"<>]+", re.I)
_ISSUE_RE = re.compile(r"(?<![A-Za-z0-9_])#(\d+)\b")
_PATH_RE = re.compile(
    r"\b([\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json|yml|yaml|toml|css))\b",
    re.I,
)
_REPO_RE = re.compile(r"\b([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\b")
_BACKTICK_RE = re.compile(r"`([^`]+)`")
_ABSOLUTE_RE = re.compile(
    r"\b(always|never|guarantees?|100%|definitely|impossible|no risk)\b",
    re.I,
)


def _normalize_url(url: str) -> str:
    cleaned = url.rstrip(".,;:)")
    try:
        parsed = urlparse(cleaned)
        if parsed.scheme not in ("http", "https"):
            return cleaned.lower()
        host = (parsed.netloc or "").lower()
        path = (parsed.path or "").rstrip("/")
        return f"{host}{path}"
    except Exception:
        return cleaned.lower()


def extract_citations(draft: str) -> list[dict[str, str]]:
    """Pull citation-like spans from a draft (order preserved, de-duped)."""
    seen: set[str] = set()
    out: list[dict[str, str]] = []

    def add(kind: str, text: str, *, url: str | None = None) -> None:
        key = f"{kind}:{text.lower()}"
        if key in seen:
            return
        seen.add(key)
        row: dict[str, str] = {"kind": kind, "text": text}
        if url:
            row["url"] = url
        out.append(row)

    for m in _URL_RE.finditer(draft):
        raw = m.group(0).rstrip(".,;:)")
        add("url", raw, url=raw)

    for m in _ISSUE_RE.finditer(draft):
        add("issue", f"#{m.group(1)}")

    for m in _PATH_RE.finditer(draft):
        add("path", m.group(1))

    for m in _BACKTICK_RE.finditer(draft):
        inner = m.group(1).strip()
        if inner and len(inner) < 160:
            add("code", inner)

    for m in _REPO_RE.finditer(draft):
        repo = m.group(1)
        if repo.lower().startswith(("http://", "https://")):
            continue
        # Skip version-like or path-like false positives.
        if "." in repo.split("/")[0] and repo.split("/")[0].count(".") >= 2:
            continue
        add("repo", repo, url=f"https://github.com/{repo}")

    return out


def _evidence_haystack(evidence: str) -> str:
    return evidence.lower()


def validate_citation(cite: dict[str, str], evidence: str) -> dict[str, Any]:
    """Mark a citation verified when its token appears in the evidence pack."""
    e = _evidence_haystack(evidence)
    kind = cite.get("kind", "")
    text = cite.get("text", "")
    verified = False
    matched: str | None = None

    if kind == "url":
        needle = _normalize_url(text)
        e_compact = re.sub(r"\s+", "", e)
        if needle and (needle in e or needle in e_compact):
            verified = True
            matched = text
        elif any(part and len(part) > 4 and part in e for part in needle.split("/") if part):
            # Host or path fragment present in evidence JSON.
            verified = True
            matched = text
    elif kind == "issue":
        if text.lower() in e or text.lstrip("#") in e:
            verified = True
            matched = text
    elif kind in ("path", "code", "repo"):
        token = text.lower()
        if token in e:
            verified = True
            matched = text
        elif kind == "repo" and "/" in token:
            owner, _, name = token.partition("/")
            if owner in e and name in e:
                verified = True
                matched = text

    row: dict[str, Any] = {**cite, "verified": verified}
    if matched:
        row["matched"] = matched
    return row


def extract_evidence_links(evidence: str, limit: int = 12) -> list[dict[str, str]]:
    """Collect http(s) links and owner/repo refs from the evidence pack."""
    links: list[dict[str, str]] = []
    seen: set[str] = set()

    for m in _URL_RE.finditer(evidence):
        url = m.group(0).rstrip(".,;:)")
        key = url.lower()
        if key in seen:
            continue
        seen.add(key)
        links.append({"label": url, "url": url})
        if len(links) >= limit:
            return links

    for m in _REPO_RE.finditer(evidence):
        repo = m.group(1)
        if "/" not in repo:
            continue
        url = f"https://github.com/{repo}"
        key = url.lower()
        if key in seen:
            continue
        seen.add(key)
        links.append({"label": repo, "url": url})
        if len(links) >= limit:
            break
    return links


def eval_draft(question: str, draft: str, evidence: str) -> dict[str, Any]:
    q = question.lower()
    d = draft.strip()
    e = evidence.lower()
    words = [w for w in re.sub(r"[^\w\s./+-]", " ", q).split() if len(w) > 3][:12]
    hit = sum(1 for w in words if w in d.lower())
    coverage = hit / len(words) if words else 0.5

    citations_raw = extract_citations(d)
    citations = [validate_citation(c, evidence) for c in citations_raw]
    verified_n = sum(1 for c in citations if c.get("verified"))
    has_cite = len(citations) > 0
    invent_risk = bool(
        _ABSOLUTE_RE.search(d) and verified_n == 0 and len(evidence) < 200
    )
    grounded = len(evidence) > 40 and (verified_n > 0 or (has_cite and coverage >= 0.35))
    completeness = min(1.0, len(d) / 280) * 0.5 + coverage * 0.5
    if verified_n > 0:
        citation = min(1.0, 0.55 + 0.15 * verified_n)
    elif has_cite:
        citation = 0.35
    elif "readme" in e or "path" in e:
        citation = 0.4
    else:
        citation = 0.15
    groundedness = 0.25 if invent_risk else (0.85 if grounded else 0.45)
    overall = round((groundedness * 0.45 + completeness * 0.35 + citation * 0.2) * 100, 1)
    passed = overall >= 55 and not invent_risk and (verified_n > 0 or not has_cite or coverage >= 0.4)

    revisions: list[str] = []
    warnings: list[str] = []
    if not has_cite:
        revisions.append("Add citations: file paths, #issue/#PR, or source URLs from the evidence.")
    unverified = [c for c in citations if not c.get("verified")]
    if unverified:
        sample = ", ".join(c["text"] for c in unverified[:4])
        warnings.append(f"Unverified citations (not found in evidence): {sample}")
        revisions.append("Replace unverified citations with tokens that appear in the evidence pack.")
    if coverage < 0.35:
        revisions.append("Address more of the user question terms explicitly.")
    if len(d) < 120:
        revisions.append("Expand the answer with concrete evidence details.")
    if invent_risk:
        warnings.append("Absolute claims without verified citations.")
        revisions.append("Remove absolute claims that are not backed by the pack.")
    for m in _ABSOLUTE_RE.finditer(d):
        # Soft warning even when some cites exist.
        span = d[max(0, m.start() - 40) : m.end() + 40].strip()
        if verified_n == 0:
            warnings.append(f"Strong wording near: “{span[:90]}”")
            break
    if passed and not revisions:
        revisions.append("Ship as-is.")

    # De-dupe warnings while preserving order.
    seen_w: set[str] = set()
    uniq_warnings: list[str] = []
    for w in warnings:
        if w not in seen_w:
            seen_w.add(w)
            uniq_warnings.append(w)

    return {
        "scores": {
            "groundedness": round(groundedness, 2),
            "completeness": round(completeness, 2),
            "citation": round(citation, 2),
            "overall": overall,
        },
        "pass": passed,
        "revisions": revisions,
        "citations": citations,
        "warnings": uniq_warnings,
        "evidence_links": extract_evidence_links(evidence),
        "note": (
            "Heuristic rubric with citation checks against the evidence pack "
            "(no paid eval API). Treat unverified citations as warnings."
        ),
    }
