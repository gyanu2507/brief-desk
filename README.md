# brief-desk

Agentic engineering desk: **CopilotKit** chat UI, **AG-UI** streaming protocol, **MCP** tools.

```
Browser (CopilotKit)
    │  AG-UI events
    ▼
Next.js CopilotRuntime + BuiltInAgent
    │  MCP Streamable HTTP
    ▼
brief-desk MCP (:3108)
    ├── workspace-brief  → any GitHub repo (or offline sample)
    └── corpus-brief     → local .md/.txt corpus
```

Not a toy chatbot wrapper. The model only answers after calling MCP tools that hit real brief backends.

## Setup

Uses **Groq** by default (free tier, OpenAI-compatible). No OpenAI account required.

```bash
cd brief-desk
cp .env.example .env.local
# set OPENAI_API_KEY to your Groq key (https://console.groq.com)
# OPENAI_BASE_URL and COPILOTKIT_AGENT_MODEL are already set for Groq in .env.example
npm install

# tool backends (once)
pip install -e ../workspace-brief
pip install -e ../corpus-brief
```

## Run

```bash
npm run dev
```

- UI: http://localhost:3000  
- MCP health: http://127.0.0.1:3108/health  
- MCP endpoint: http://127.0.0.1:3108/mcp  

In the UI, set **GitHub repo** to any `owner/name` (saved in the browser). Chat then calls `brief_workspace` with `source=github` against the live API.

Without a repo, questions use the offline sample fixture. Corpus questions still work via `brief_corpus`.

On the MCP host (local or Render), set `GITHUB_TOKEN` so public repos are not rate-limited quickly. Do **not** set `BRIEF_ALLOWED_REPOS` if you want any repo. Keep `BRIEF_SOURCE=fixture` as the no-repo fallback.

## Verify

```bash
npm run test:mcp
which brief && brief --source fixture "what are the main risks?" | head
which corpus-brief && corpus-brief "checkout promo" | head
```

## Stack

| Layer | Package / project |
|---|---|
| UI | `@copilotkit/react-core`, `@copilotkit/react-ui` |
| Runtime | `@copilotkit/runtime` (`BuiltInAgent` + `mcpServers`) |
| Protocol | AG-UI (`@ag-ui/client` via CopilotKit) |
| Tools | `@modelcontextprotocol/sdk` Streamable HTTP server |
| Backends | [workspace-brief](https://github.com/gyanu2507/workspace-brief), [corpus-brief](https://github.com/gyanu2507/corpus-brief) |

MIT.
