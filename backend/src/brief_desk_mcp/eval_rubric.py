from __future__ import annotations

import re
from typing import Any


def eval_draft(question: str, draft: str, evidence: str) -> dict[str, Any]:
    q = question.lower()
    d = draft.strip()
    e = evidence.lower()
    words = [w for w in re.sub(r"[^\w\s./+-]", " ", q).split() if len(w) > 3][:12]
    hit = sum(1 for w in words if w in d.lower())
    coverage = hit / len(words) if words else 0.5
    has_cite = bool(
        re.search(r"#\d+", d)
        or re.search(r"\b[\w.-]+\.(ts|tsx|js|jsx|py|go|rs|md|json|yml|yaml)\b", d, re.I)
        or re.search(r"https?://github\.com/", d, re.I)
        or re.search(r"`[^`]+`", d)
    )
    invent_risk = bool(
        re.search(r"\b(always|never|guarantees?|100%|definitely)\b", d, re.I)
        and not has_cite
        and len(evidence) < 200
    )
    grounded = len(evidence) > 40 and (has_cite or coverage >= 0.35)
    completeness = min(1.0, len(d) / 280) * 0.5 + coverage * 0.5
    citation = 1.0 if has_cite else (0.4 if ("readme" in e or "path" in e) else 0.15)
    groundedness = 0.25 if invent_risk else (0.85 if grounded else 0.45)
    overall = round((groundedness * 0.45 + completeness * 0.35 + citation * 0.2) * 100, 1)
    passed = overall >= 55 and not invent_risk
    revisions: list[str] = []
    if not has_cite:
        revisions.append("Add citations: file paths, #issue/#PR, or source URLs from the evidence.")
    if coverage < 0.35:
        revisions.append("Address more of the user question terms explicitly.")
    if len(d) < 120:
        revisions.append("Expand the answer with concrete evidence details.")
    if invent_risk:
        revisions.append("Remove absolute claims that are not backed by the pack.")
    if passed and not revisions:
        revisions.append("Ship as-is.")
    return {
        "scores": {
            "groundedness": round(groundedness, 2),
            "completeness": round(completeness, 2),
            "citation": round(citation, 2),
            "overall": overall,
        },
        "pass": passed,
        "revisions": revisions,
        "note": "Free heuristic rubric (no paid eval API). Use revisions before the final user-facing answer.",
    }
