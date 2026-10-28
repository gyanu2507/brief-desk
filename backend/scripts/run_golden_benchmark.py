#!/usr/bin/env python3
"""Run the golden brief_eval set and print quality / latency / cost metrics."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from brief_desk_mcp.eval_rubric import eval_draft  # noqa: E402

CASES = ROOT / "tests" / "golden" / "cases.json"


def main() -> int:
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    rows = []
    for case in cases:
        t0 = time.perf_counter()
        result = eval_draft(case["question"], case["draft"], case["evidence"])
        ms = (time.perf_counter() - t0) * 1000
        chars = len(case["question"]) + len(case["draft"]) + len(case["evidence"])
        rows.append(
            {
                "id": case["id"],
                "pass": result["pass"],
                "overall": result["scores"]["overall"],
                "groundedness": result["scores"]["groundedness"],
                "citation": result["scores"]["citation"],
                "ms": round(ms, 3),
                "chars": chars,
                "verified": sum(1 for c in result.get("citations", []) if c.get("verified")),
                "warnings": len(result.get("warnings", [])),
            }
        )

    pass_rate = sum(1 for r in rows if r["pass"]) / len(rows) if rows else 0
    report = {
        "cases": len(rows),
        "pass_rate": round(pass_rate, 3),
        "avg_overall": round(sum(r["overall"] for r in rows) / len(rows), 2) if rows else 0,
        "avg_latency_ms": round(sum(r["ms"] for r in rows) / len(rows), 3) if rows else 0,
        "cost_usd": 0.0,
        "cost_note": "Heuristic brief_eval uses no model API; rubric cost is $0.",
        "limitation": (
            "Scores are heuristic (coverage + citation match), not LLM-as-judge. "
            "Draft-model latency/cost are outside this report."
        ),
        "rows": rows,
    }
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
