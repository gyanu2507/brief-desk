# brief-desk

One-repo engineering briefing app: multi-source control panel, CopilotKit chat,
AG-UI streaming, MCP tools, and a deterministic **gather → draft → eval** run path.

```
Browser
    │
    ├─ Run agent / demos  →  POST /api/brief-run  →  MCP + Groq draft
    └─ Free-form chat     →  CopilotKit → MCP tools
                │
                ▼
         brief-desk MCP (this repo)
           ├── brief_auto / brief_orchestrate
           ├── brief_eval
           ├── brief_fetch_url
           ├── GitHub tools
           └── brief_corpus  →  mcp/corpus/*.md
```

No `workspace-brief` or `corpus-brief` installs. Corpus sample docs ship under `mcp/corpus/`.

## Setup

```bash
cd brief-desk
cp .env.example .env.local
# OPENAI_API_KEY = Groq key (https://console.groq.com)
npm install
```

## Run

```bash
npm run dev
```

- UI: http://localhost:3000
- MCP health: http://127.0.0.1:3108/health

### Sources

| Source | What you set | Behavior |
|---|---|---|
| **Auto** | free-form goal with `owner/name` or `https://…` | `brief_auto` then draft/eval |
| GitHub | `owner/name` + brief type | guided orchestrate |
| Docs | public URL | fetch + brief |
| Compare | two repos | side-by-side |
| Corpus | none | bundled `mcp/corpus` docs |

Queries and demos sit in the left panel above the fold. **Run agent** uses
`POST /api/prompts` templates plus `POST /api/brief-run` so a brief always returns.

## Verify

```bash
npm test
curl -s http://127.0.0.1:3108/health
curl -s -X POST http://localhost:3000/api/brief-run \
  -H 'content-type: application/json' \
  -d '{"source":"auto","goal":"Brief facebook/react risks","question":"Brief facebook/react risks"}'
```

**Render:** Manual Deploy after MCP changes. Target `version` ≥ `0.6.0`.

## Stack

| Layer | Notes |
|---|---|
| UI | CopilotKit React + control panel |
| Run path | `/api/brief-run` (deterministic) |
| Runtime | BuiltInAgent + MCP over AG-UI (chat) |
| Tools | All in `mcp/src` + `mcp/corpus` |
| Eval | Free heuristic rubric |

MIT.
