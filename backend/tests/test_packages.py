import pytest

from brief_desk_mcp.packages import lookup_npm, lookup_pypi
from brief_desk_mcp.plan import build_autonomous_plan


@pytest.mark.asyncio
async def test_lookup_npm_zod():
    out = await lookup_npm("zod")
    assert out.get("registry") == "npm"
    assert out.get("package") == "zod"
    assert out.get("latest")
    assert not out.get("error")


@pytest.mark.asyncio
async def test_lookup_pypi_httpx():
    out = await lookup_pypi("httpx")
    assert out.get("registry") == "pypi"
    assert (out.get("package") or "").lower() == "httpx"
    assert out.get("latest")
    assert not out.get("error")


def test_plan_invents_npm_package():
    plan = build_autonomous_plan("Brief the npm package zod for an engineer")
    inv = plan["invented"]
    assert inv["source_kind"] == "package"
    assert inv["npm_package"] == "zod"


def test_plan_invents_pypi_package():
    plan = build_autonomous_plan("Brief the pypi package httpx for async HTTP")
    inv = plan["invented"]
    assert inv["source_kind"] == "package"
    assert inv["pypi_package"] == "httpx"
