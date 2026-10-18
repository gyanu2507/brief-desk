# brief-desk

Full briefing **app** (not a GitHub-only chat demo): multi-source control panel,
**CopilotKit** chat, **AG-UI** streaming, **MCP** tools, **orchestrate → draft → eval**.

```
Browser (CopilotKit)
    │  AG-UI events
    ▼
Next.js CopilotRuntime + BuiltInAgent
    │  MCP Streamable HTTP
    ▼
brief-desk MCP
    ├── brief_orchestrate  → plan + gather (repo / URL / compare / modes)
    ├── brief_eval         → free heuristic rubric
    ├── brief_fetch_url    → public docs pages
    ├── GitHub tools       → overview / ask / file / workspace-brief
    └── brief_corpus       → local .md/.txt sample
```

## Setup

Uses **Groq** by default (free tier). No paid eval APIs.

```bash
cd brief-desk
cp .env.example .env.local
# OPENAI_API_KEY = Groq key (https://console.groq.com)
npm install
pip install -e ../workspace-brief
pip install -e ../corpus-brief
```

## Run

```bash
npm run dev
```

- UI: http://localhost:3000
- MCP health: http://127.0.0.1:3108/health

### App sources (left panel)

| Source | What you set | Example ask in chat |
|---|---|---|
| GitHub | `owner/name` + brief type | features / risks / architecture / code |
| Docs URL | `https://…` (+ optional repo) | summarize / extract APIs |
| Compare | Repo A + Repo B | which to pick for a SaaS app |
| Corpus | none | questions about the bundled sample docs |

Also: MCP health indicator, saved session shortcuts, agent log.

Default loop: **`brief_orchestrate`** → draft → **`brief_eval`**. Revise if `pass=false`.

`GITHUB_TOKEN` on the MCP host unlocks code search and higher GitHub rate limits.

## Verify

```bash
npm run test:mcp
curl -s http://127.0.0.1:3108/health
```

## Stack

| Layer | Notes |
|---|---|
| UI | CopilotKit React chat |
| Runtime | BuiltInAgent + MCP over AG-UI |
| Orchestrator | `brief_orchestrate` modes: overview, risks, architecture, activity, code, docs, compare, general |
| Eval | Free rubric (groundedness / completeness / citations) |
| Sources | GitHub API, public HTTP(S) URLs, corpus-brief, workspace-brief |

MIT.
