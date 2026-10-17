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

```bash
# UI + MCP
cd brief-desk
cp .env.example .env.local   # add OPENAI_API_KEY
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

Ask in chat: `what are the open checkout risks?` (sample workspace) or `how do webhooks stay idempotent?` (sample corpus).

Live GitHub:

```bash
BRIEF_SOURCE=github BRIEF_REPO=owner/name GITHUB_TOKEN=… npm run dev
```

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
