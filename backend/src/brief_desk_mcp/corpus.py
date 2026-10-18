from __future__ import annotations

import re
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    # backend/src/brief_desk_mcp/corpus.py -> brief-desk/
    return Path(__file__).resolve().parents[3]


def corpus_root(custom: str | None = None) -> Path:
    if custom:
        p = Path(custom)
        if p.exists():
            return p
    return _repo_root() / "mcp" / "corpus"


def tokenize(q: str) -> list[str]:
    words = re.sub(r"[^\w\s./+-]", " ", q.lower()).split()
    return [w for w in words if len(w) > 2][:12]


def search_corpus(question: str, corpus_dir: str | None = None) -> dict[str, Any]:
    root = corpus_root(corpus_dir)
    terms = tokenize(question)
    files = (
        [f for f in root.iterdir() if f.suffix.lower() in {".md", ".txt"}]
        if root.exists()
        else []
    )
    hits: list[dict[str, Any]] = []
    for file in files:
        text = file.read_text(encoding="utf-8", errors="replace")
        lower = text.lower()
        score = 0
        for t in terms:
            if t in lower:
                score += 1
            if t in file.name.lower():
                score += 1
        if score == 0 and not terms:
            score = 1
        if score == 0:
            continue
        hits.append({"path": file.name, "score": score, "excerpt": text.strip()[:600]})
    hits.sort(key=lambda h: h["score"], reverse=True)
    return {
        "question": question,
        "corpus": str(root),
        "hits": hits[:6],
        "guidance": (
            "Answer from these local corpus hits only. Cite file paths."
            if hits
            else "No local hits. Say the bundled sample does not cover the question."
        ),
    }
