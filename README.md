# brief-desk

One-repo engineering briefing app: Next.js UI + **Python MCP backend**,
CopilotKit chat, AG-UI streaming, and a deterministic **gather → draft → eval** path.

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
           ├── brief_fetch_url
           ├── GitHub tools
           └── brief_corpus  →  mcp/corpus/*.md
```

Corpus sample docs ship under `mcp/corpus/`. No separate workspace/corpus packages.

## Setup

```bash
cd brief-desk
cp .env.example .env.local
# OPENAI_API_KEY = Groq key (https://console.groq.com)
npm install
# Python MCP (uv installs deps from backend/pyproject.toml)
cd backend && uv sync && cd ..
```

Requires [uv](https://github.com/astral-sh/uv) and Python 3.11+.

## Run

```bash
npm run dev
```

- UI: http://localhost:3000
- Python MCP health: http://127.0.0.1:3108/health (`runtime: python`, `version: 0.7.0`)

Legacy TypeScript MCP (optional): `npm run dev:mcp:ts`

### Sources

| Source | What you set | Behavior |
|---|---|---|
| **Auto** | free-form goal with `owner/name` or `https://…` | `brief_auto` then draft/eval |
| GitHub | `owner/name` + brief type | guided orchestrate |
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

**Render:** deploy with the root `Dockerfile` (Python MCP). After deploy, `/health` should show `"runtime":"python"` and `"version":"0.7.0"`.

## Stack

| Layer | Notes |
|---|---|
| UI | CopilotKit React + control panel (Next.js / Vercel) |
| Run path | `/api/brief-run` (deterministic) |
| Tools backend | Python MCP Streamable HTTP (`backend/`) |
| Corpus | `mcp/corpus/*.md` |
| Eval | Free heuristic rubric |

MIT.
