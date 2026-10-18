# Route: github

When source_kind=github:

1. Require repo as owner/name. If missing, ask once.
2. Call brief_orchestrate with repo and mode (overview|risks|architecture|activity|code|docs|general).
3. Draft only from the gather pack.
4. Call brief_eval, revise once if pass=false, then answer with citations.
