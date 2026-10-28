from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from brief_desk_mcp.eval_rubric import eval_draft

CASES_PATH = Path(__file__).parent / "golden" / "cases.json"


def _load_cases() -> list[dict]:
    return json.loads(CASES_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: c["id"])
def test_golden_case(case: dict) -> None:
    expect = case["expect"]
    t0 = time.perf_counter()
    result = eval_draft(case["question"], case["draft"], case["evidence"])
    ms = (time.perf_counter() - t0) * 1000

    assert ms < 250, f"{case['id']} too slow: {ms:.1f}ms"

    if "pass" in expect:
        assert result["pass"] is expect["pass"], result
    if "min_overall" in expect:
        assert result["scores"]["overall"] >= expect["min_overall"], result["scores"]
    if "max_overall" in expect:
        assert result["scores"]["overall"] <= expect["max_overall"], result["scores"]
    if "min_verified" in expect:
        verified = sum(1 for c in result.get("citations", []) if c.get("verified"))
        assert verified >= expect["min_verified"], result.get("citations")
    if "min_unverified" in expect:
        unverified = sum(1 for c in result.get("citations", []) if not c.get("verified"))
        assert unverified >= expect["min_unverified"], result.get("citations")
    if "max_warnings" in expect:
        assert len(result.get("warnings", [])) <= expect["max_warnings"]
    if "min_revisions" in expect:
        assert len(result.get("revisions", [])) >= expect["min_revisions"]


def test_golden_benchmark_report_shape() -> None:
    """Aggregate quality / latency / cost-proxy metrics for the golden set."""
    rows = []
    for case in _load_cases():
        t0 = time.perf_counter()
        result = eval_draft(case["question"], case["draft"], case["evidence"])
        ms = (time.perf_counter() - t0) * 1000
        # Cost proxy: chars processed (no paid API in heuristic eval).
        chars = len(case["question"]) + len(case["draft"]) + len(case["evidence"])
        rows.append(
            {
                "id": case["id"],
                "pass": result["pass"],
                "overall": result["scores"]["overall"],
                "ms": round(ms, 3),
                "chars": chars,
                "verified": sum(1 for c in result.get("citations", []) if c.get("verified")),
                "warnings": len(result.get("warnings", [])),
            }
        )

    assert rows
    pass_rate = sum(1 for r in rows if r["pass"]) / len(rows)
    avg_overall = sum(r["overall"] for r in rows) / len(rows)
    avg_ms = sum(r["ms"] for r in rows) / len(rows)
    # Heuristic eval is free; cost_usd stays 0 with a clear note in the report helper.
    report = {
        "cases": len(rows),
        "pass_rate": round(pass_rate, 3),
        "avg_overall": round(avg_overall, 2),
        "avg_latency_ms": round(avg_ms, 3),
        "cost_usd": 0.0,
        "cost_note": "Heuristic brief_eval uses no model API; cost is $0 for the rubric itself.",
        "rows": rows,
    }
    assert report["cases"] == len(_load_cases())
    assert 0 <= report["pass_rate"] <= 1
    assert report["avg_latency_ms"] < 100
