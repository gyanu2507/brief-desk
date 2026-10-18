# brief-desk

One-repo engineering briefing desk: Next.js + CopilotKit (AG-UI) + **Python MCP**.

Pick a source (auto, GitHub, docs URL, compare, corpus), run the agent, get a cited brief. Free-form chat can call the same MCP tools. Tool cards, a live plan board, and cancel are built into the UI.

```
Browser
    │
    ├─ Run agent / demos  →  POST /api/brief-run  →  MCP + Groq draft
    └─ Free-form chat     →  CopilotKit → MCP tools
                │
                ▼
         Python MCP (backend/)
           ├── brief_auto / brief_orchestrate
           ├── brief_eval
           ├── brief_fetch_url / brief_web_search
           ├── brief_github_trending / brief_github_search
           ├── brief_repo_* (ask/overview/file/releases/security)
           └── brief_corpus  →  mcp/corpus/*.md
```

## Features

- **Deterministic run path** (`/api/brief-run`): gather → draft → eval → revise
- **Autonomous auto mode** (`brief_auto`): invents plan from a free-form goal
- **Web search** (`brief_web_search`): DuckDuckGo Instant Answer, no API key
- **GitHub trending** (`brief_github_trending`): live scrape of github.com/trending
- **Repo search** (`brief_github_search`): GitHub Search API shortlists
- **Releases + security** (`brief_repo_releases`, `brief_repo_security`)
- **In-chat tool cards** for MCP calls on the free-form path
- **Live plan board** + **Cancel run** on the control panel
- **Light / dark / system** theme
- Bundled sample corpus under `mcp/corpus/` (no separate packages)

## Setup

```bash
cd brief-desk
cp .env.example .env.local
# OPENAI_API_KEY = Groq key (https://console.groq.com)
npm install
# Python MCP (uv installs deps from backend/pyproject.toml)
cd backend && uv sync && cd ..
```

Requires [uv](https://github.com/astral-sh/uv) and Python 3.11+. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Run

```bash
npm run dev
```

- UI: http://localhost:3000
- Python MCP health: http://127.0.0.1:3108/health (`runtime: python`, `version: 0.9.0`)

Legacy TypeScript MCP (optional): `npm run dev:mcp:ts`

### Sources

| Source | What you set | Behavior |
|---|---|---|
| **Auto** | free-form goal with `owner/name`, URL, trending, or “find libs…” | `brief_auto` then draft/eval |
| **Trending** | language + daily/weekly/monthly | live GitHub trending shortlist |
| GitHub | `owner/name` + brief type | guided orchestrate (+ releases/security on risks) |
| Docs | public URL | fetch + brief |
| Compare | two repos | side-by-side |
| Corpus | none | bundled `mcp/corpus` docs |

## Verify

```bash
npm test
curl -s http://127.0.0.1:3108/health
curl -s -X POST http://localhost:3000/api/brief-run \
  -H 'content-type: application/json' \
  -d '{"source":"auto","goal":"Brief facebook/react risks","question":"Brief facebook/react risks"}'
```

CI runs the same suite on every push/PR (`.github/workflows/ci.yml`).

**Render:** deploy with the root `Dockerfile` (Python MCP). After deploy, `/health` should show `"runtime":"python"` and `"version":"0.9.0"`.

**Vercel:** point `MCP_URL` at that Render `/mcp` endpoint.

## Stack

| Layer | Notes |
|---|---|
| UI | CopilotKit React + control panel (Next.js / Vercel) |
| Run path | `/api/brief-run` (deterministic) |
| Tools backend | Python MCP Streamable HTTP (`backend/`) |
| Web | DuckDuckGo Instant Answer |
| Corpus | `mcp/corpus/*.md` |
| Eval | Free heuristic rubric |

## License

MIT. See [LICENSE](./LICENSE).
