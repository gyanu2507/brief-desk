# Python MCP backend for Render (and local docker).
FROM python:3.12-slim

WORKDIR /app

COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/src /app/backend/src
COPY mcp/corpus /app/mcp/corpus

RUN pip install --no-cache-dir /app/backend

ENV HOST=0.0.0.0
ENV PORT=3108
EXPOSE 3108

CMD ["python", "-m", "brief_desk_mcp"]
