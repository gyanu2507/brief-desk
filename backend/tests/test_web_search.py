import pytest

from brief_desk_mcp.web_search import search_web


@pytest.mark.asyncio
async def test_web_search_mcp_topic():
    out = await search_web("Model Context Protocol")
    assert out["query"]
    assert "hits" in out
    # Instant Answer can be sparse; at least return a well-shaped pack.
    assert out.get("source") == "duckduckgo_instant_answer"
    assert "guidance" in out
