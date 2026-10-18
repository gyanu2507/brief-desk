import pytest

from brief_desk_mcp.discover import _parse_trending_html, fetch_trending
from brief_desk_mcp.plan import build_autonomous_plan


SAMPLE_HTML = """
<article class="Box-row">
  <h2>
    <a href="/vercel/next.js">vercel / next.js</a>
  </h2>
  <p>The React Framework</p>
  <span>1,234 stars this week</span>
  <span itemprop="programmingLanguage">TypeScript</span>
</article>
<article class="Box-row">
  <h2>
    <a href="/facebook/react">facebook / react</a>
  </h2>
  <p>A library for web UIs</p>
  <span>900 stars this week</span>
</article>
"""


def test_parse_trending_html():
    repos = _parse_trending_html(SAMPLE_HTML, 10)
    assert len(repos) == 2
    assert repos[0]["repo"] == "vercel/next.js"
    assert repos[0]["stars_delta"] == "1234"
    assert repos[1]["repo"] == "facebook/react"


def test_plan_invents_trending():
    plan = build_autonomous_plan("What TypeScript repos are trending on GitHub this week?")
    inv = plan["invented"]
    assert inv["source_kind"] == "trending"
    assert inv["language"] == "typescript"
    assert inv["since"] == "weekly"


def test_plan_invents_discover():
    plan = build_autonomous_plan("Find React form libraries with strong TypeScript support")
    assert plan["invented"]["source_kind"] == "discover"


@pytest.mark.asyncio
async def test_fetch_trending_live():
    out = await fetch_trending(language="typescript", since="weekly", max_results=5)
    assert out["source"] == "github_trending"
    assert "repos" in out
    # Live page can be flaky; shape must stay stable.
    assert out.get("since") == "weekly"
    if out.get("repos"):
        assert "repo" in out["repos"][0]
