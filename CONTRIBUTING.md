# Contributing to brief-desk

Thanks for helping. Keep changes small and testable.

## Setup

```bash
cd brief-desk
cp .env.example .env.local
# Set OPENAI_API_KEY (Groq) and optional GITHUB_TOKEN
npm install
cd backend && uv sync && cd ..
npm run dev
```

- UI: http://localhost:3000
- MCP health: http://127.0.0.1:3108/health

## Layout

| Path | Role |
|---|---|
| `app/` | Next.js UI (chat, controls, theme) |
| `lib/` | brief-run pipeline, MCP client, prompts |
| `backend/` | Python MCP Streamable HTTP server |
| `mcp/corpus/` | Bundled sample docs |
| `prompts/` | System / route prompt files |

## Checks before a PR

```bash
npm test
npm run typecheck
```

Python-only: `npm run test:mcp:py`

## Conventions

- Prefer the deterministic `/api/brief-run` path for panel demos. Free-form chat uses CopilotKit + MCP tools.
- Do not add a separate workspace/corpus package. Corpus lives in `mcp/corpus/`.
- Match existing TypeScript and Python style. Skip drive-by refactors.
- English commit messages and PR descriptions.

## Deploy notes

- **Vercel:** Next.js app. Set `MCP_URL` to the Render MCP endpoint (`…/mcp`).
- **Render:** use the root `Dockerfile` so `/health` reports `"runtime":"python"` and the current package version.

## License

MIT. By contributing you agree your changes are under the same license.
