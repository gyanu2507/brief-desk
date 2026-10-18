from brief_desk_mcp.plan import build_autonomous_plan, classify_brief_mode, normalize_github_repo


def test_normalize_repo():
    assert normalize_github_repo("https://github.com/facebook/react") == "facebook/react"
    assert normalize_github_repo("bad") is None


def test_classify_risks_and_compare():
    assert classify_brief_mode("what are the risks?") == "risks"
    assert classify_brief_mode("compare next vs remix") == "compare"


def test_autonomous_plan_github():
    plan = build_autonomous_plan("Brief facebook/react risks for an eng manager.")
    assert plan["invented"]["repo"] == "facebook/react"
    assert plan["invented"]["mode"] == "risks"
