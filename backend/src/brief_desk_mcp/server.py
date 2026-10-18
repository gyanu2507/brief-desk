"""Streamable HTTP MCP server (Python). Same tools as the former TS mcp/src/server.ts."""

from __future__ import annotations

import json
import os
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, Response

from brief_desk_mcp import __version__
from brief_desk_mcp.corpus import search_corpus
from brief_desk_mcp.eval_rubric import eval_draft
from brief_desk_mcp.github_tools import (
    decode_content_file,
    fetch_public_url,
    fetch_repo_ask,
    fetch_repo_overview,
)
from brief_desk_mcp.orchestrate import run_auto, run_orchestrate
from brief_desk_mcp.plan import build_autonomous_plan, normalize_github_repo

TOOLS = [
    "brief_auto",
    "brief_plan",
    "brief_orchestrate",
    "brief_eval",
    "brief_fetch_url",
    "brief_repo_ask",
    "brief_repo_overview",
    "brief_repo_file",
    "brief_corpus",
    "stack_info",
]

mcp = MCPServer(
    name="brief-desk-mcp",
    version=__version__,
    instructions="Engineering briefing tools for brief-desk. Prefer brief_auto, then draft + brief_eval.",
)


def _json(payload: Any) -> str:
    return payload if isinstance(payload, str) else json.dumps(payload, indent=2)


@mcp.custom_route("/health", methods=["GET"])
async def health(_request: Request) -> Response:
    return JSONResponse(
        {
            "ok": True,
            "mcp": "/mcp",
            "service": "brief-desk-mcp",
            "runtime": "python",
            "version": __version__,
            "ready": True,
            "preferred_auto": "brief_auto",
            "tools": TOOLS,
        }
    )


@mcp.custom_route("/", methods=["GET"])
async def root(_request: Request) -> Response:
    return HTMLResponse(
        f"""<!doctype html>
<html><body style="font-family:system-ui;padding:2rem;max-width:40rem">
  <h1>brief-desk MCP</h1>
  <p>Python tool server (v{__version__}), not the chat UI.</p>
  <ul>
    <li><a href="/health">/health</a></li>
    <li><code>POST /mcp</code> Streamable HTTP</li>
  </ul>
  <p>Deploy the Next.js app on Vercel and set <code>MCP_URL</code> to this host + <code>/mcp</code>.</p>
</body></html>"""
    )


@mcp.tool(name="brief_repo_ask", description="Ask about a GitHub repo. Intent-shaped evidence pack.")
async def brief_repo_ask(question: str, repo: str) -> str:
    target = normalize_github_repo(repo or os.environ.get("BRIEF_REPO"))
    if not target:
        raise ToolError("repo is required (owner/name)")
    try:
        return await fetch_repo_ask(target, question)
    except Exception as e:
        raise ToolError(f"brief_repo_ask failed: {e}") from e


@mcp.tool(name="brief_repo_overview", description="Fetch description + README only.")
async def brief_repo_overview(repo: str) -> str:
    target = normalize_github_repo(repo or os.environ.get("BRIEF_REPO"))
    if not target:
        raise ToolError("repo is required (owner/name)")
    try:
        return await fetch_repo_overview(target)
    except Exception as e:
        raise ToolError(f"brief_repo_overview failed: {e}") from e


@mcp.tool(name="brief_repo_file", description="Read one file from a GitHub repo by path.")
async def brief_repo_file(repo: str, path: str) -> str:
    target = normalize_github_repo(repo or os.environ.get("BRIEF_REPO"))
    if not target:
        raise ToolError("repo is required (owner/name)")
    try:
        file = await decode_content_file(path.lstrip("/"), target)
        if not file:
            raise ToolError(f"File not found or not a file: {path}")
        return _json(file)
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"brief_repo_file failed: {e}") from e


@mcp.tool(
    name="brief_corpus",
    description="Ask the bundled local markdown corpus (mcp/corpus). Not for remote GitHub repos.",
)
async def brief_corpus(question: str, corpus: str | None = None) -> str:
    return _json(search_corpus(question, corpus))


@mcp.tool(
    name="brief_plan",
    description="Autonomous planner only (no gather). Prefer brief_auto in auto mode.",
)
async def brief_plan(goal: str) -> str:
    return _json(build_autonomous_plan(goal))


@mcp.tool(
    name="brief_auto",
    description="Autonomous one-shot: invent plan from goal, then gather evidence.",
)
async def brief_auto(goal: str) -> str:
    try:
        return await run_auto(goal)
    except Exception as e:
        raise ToolError(f"brief_auto failed: {e}") from e


@mcp.tool(
    name="brief_orchestrate",
    description="Multi-source orchestrator: plan → gather → guidance.",
)
async def brief_orchestrate(
    question: str,
    repo: str | None = None,
    repo_b: str | None = None,
    url: str | None = None,
    mode: str | None = None,
) -> str:
    try:
        return await run_orchestrate(
            question=question, repo=repo, repo_b=repo_b, url=url, mode=mode
        )
    except Exception as e:
        raise ToolError(f"brief_orchestrate failed: {e}") from e


@mcp.tool(
    name="brief_eval",
    description="Free heuristic eval rubric for a draft answer.",
)
async def brief_eval(question: str, draft: str, evidence: str) -> str:
    return _json(eval_draft(question, draft, evidence))


@mcp.tool(
    name="brief_fetch_url",
    description="Fetch a public http(s) page or raw doc (HTML stripped).",
)
async def brief_fetch_url(url: str) -> str:
    try:
        return _json(await fetch_public_url(url))
    except Exception as e:
        raise ToolError(f"brief_fetch_url failed: {e}") from e


@mcp.tool(
    name="stack_info",
    description="Describe the brief-desk protocol stack.",
)
async def stack_info() -> str:
    return _json(
        {
            "ui": "CopilotKit React chat",
            "protocol": "AG-UI (agent ↔ UI stream via CopilotRuntime)",
            "tools": "MCP Streamable HTTP (Python)",
            "loop": "brief_auto (plan+gather) → draft → brief_eval → revise",
            "backends": [
                "GitHub (overview/ask/file)",
                "public URL fetch",
                "bundled mcp/corpus",
                "free heuristic eval rubric",
                "autonomous brief_auto",
            ],
            "runtime": "python",
            "version": __version__,
        }
    )


def _allowed_hosts() -> list[str]:
    extra = [
        h.strip()
        for h in (os.environ.get("MCP_ALLOWED_HOSTS") or "").split(",")
        if h.strip()
    ]
    return [
        "localhost",
        "localhost:*",
        "127.0.0.1",
        "127.0.0.1:*",
        "brief-desk.onrender.com",
        "brief-desk.onrender.com:*",
        *extra,
    ]


def main() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT") or os.environ.get("MCP_PORT") or "3108")
    security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=_allowed_hosts(),
        allowed_origins=["*"],
    )
    mcp.run(
        transport="streamable-http",
        host=host,
        port=port,
        streamable_http_path="/mcp",
        stateless_http=True,
        transport_security=security,
    )


if __name__ == "__main__":
    main()
