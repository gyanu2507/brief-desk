from brief_desk_mcp.eval_rubric import eval_draft, extract_citations, validate_citation


def test_extract_citations_urls_issues_paths():
    draft = (
        "See https://github.com/facebook/react and #123 plus `src/index.ts` "
        "and packages/react/README.md."
    )
    cites = extract_citations(draft)
    kinds = {c["kind"] for c in cites}
    assert "url" in kinds
    assert "issue" in kinds
    assert "path" in kinds or "code" in kinds


def test_validate_citation_against_evidence():
    evidence = '{"repo":"facebook/react","issues":[{"number":123}],"readme":"src/index.ts"}'
    ok = validate_citation({"kind": "issue", "text": "#123"}, evidence)
    assert ok["verified"] is True
    bad = validate_citation({"kind": "issue", "text": "#999"}, evidence)
    assert bad["verified"] is False


def test_eval_draft_flags_unverified_and_exposes_links():
    evidence = (
        '{"repo":"facebook/react","url":"https://github.com/facebook/react",'
        '"readme":"Concurrent features live in packages/react"}'
    )
    draft = (
        "Plan: github · risks · facebook/react\n\n"
        "facebook/react README covers Concurrent features in packages/react. "
        "Unrelated claim cites https://example.com/not-in-evidence."
    )
    result = eval_draft("Brief facebook/react risks", draft, evidence)
    assert "citations" in result
    assert "warnings" in result
    assert "evidence_links" in result
    assert any(not c["verified"] for c in result["citations"])
    assert any("Unverified" in w for w in result["warnings"])
    assert any("facebook/react" in link["label"] or "github.com" in link["url"] for link in result["evidence_links"])


def test_eval_draft_verified_path_passes():
    evidence = "path: src/server.ts\nrepo: vercel/next.js\nhttps://github.com/vercel/next.js"
    draft = (
        "Plan: github · overview · vercel/next.js\n\n"
        "The overview in src/server.ts matches vercel/next.js docs at "
        "https://github.com/vercel/next.js."
    )
    result = eval_draft("Summarize vercel/next.js server entry", draft, evidence)
    assert result["pass"] is True
    assert any(c["verified"] for c in result["citations"])
    assert result["scores"]["citation"] >= 0.55
