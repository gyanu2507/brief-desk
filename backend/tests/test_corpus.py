from brief_desk_mcp.corpus import search_corpus


def test_checkout_promo():
    out = search_corpus("What is the checkout promo about?")
    assert out["hits"]
    assert any(h["path"] == "checkout.md" for h in out["hits"])


def test_billing():
    out = search_corpus("refunds billing")
    assert any("billing" in h["path"] for h in out["hits"])
