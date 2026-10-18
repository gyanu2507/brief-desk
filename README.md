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
    ├── brief_plan         → invent source/mode/targets/subgoals from a goal
    ├── brief_orchestrate  → gather (repo / URL / compare / modes)
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

| Source | What you set | What the agent does |
|---|---|---|
| **Auto** (default) | a free-form goal with `owner/name` or `https://…` | `brief_auto` invents plan + gathers, then draft/eval |
| GitHub | `owner/name` + brief type | guided orchestrate → eval |
| Docs URL | `https://…` (+ optional repo) | fetch + brief |
| Compare | Repo A + Repo B | side-by-side |
| Corpus | none | bundled sample docs |

Also: MCP health indicator, saved session shortcuts, agent log.

Autonomous loop: **`brief_auto`** (plan+gather) → draft → **`brief_eval`**. Revise if `pass=false`.
Keep it short: no `brief_workspace` after gather.

### Prompt-file routing

Agent routing, the plan → orchestrate → eval loop, Start brief / Auto text, demos, and suggest chips
all come from `prompts/` (not hardcoded in the agent).

```
prompts/
  system.md                 # agent identity + autonomous loop
  router.md                 # how to pick a route from session fields
  routes/
    auto.md | github.md | url.md | compare.md | corpus.md | followup.md
  templates/
    auto-brief.md           # Run agent (goal-only)
    start-brief.md          # guided Start brief
  ui.json                   # demos, suggests, modes, session notes
```

- BuiltInAgent loads `system.md` + `router.md` + every `routes/*.md` at boot.
- UI loads demos/suggests via `GET /api/prompts`.
- Auto / Start brief renders templates via `POST /api/prompts`.

Edit a route file and redeploy the Next app to change behavior. No TypeScript change required
for copy or routing instructions.

**Render:** Manual Deploy after every MCP change. Target health: `version` ≥ `0.5.2`, tools include `brief_auto`.
Until then the UI runs in **compat mode** (`brief_plan` → `brief_orchestrate`) and still bans `brief_workspace`.

### Reliability rules

- **Run agent / demos** use deterministic `POST /api/brief-run` (gather → draft → eval). No flaky multi-step chat loop.
- Free-form chat still uses CopilotKit (Qwen on Groq by default).
- `brief_workspace` is deprecated and always skipped
- GitHub/URL fetches time out at 10s; CLI tools at 8s
- UI ships fallback demos so the left panel is never empty
- 90s client watchdog surfaces a clear timeout error for chat runs

`GITHUB_TOKEN` on the MCP host unlocks code search and higher GitHub rate limits.

## Verify

```bash
npm test
curl -s http://127.0.0.1:3108/health
curl -s http://localhost:3000/api/prompts | head
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
