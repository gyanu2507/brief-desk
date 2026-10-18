# Route: compare

When source_kind=compare:

1. Require two repos: repo and repo_b (both owner/name).
2. Call brief_orchestrate with mode=compare, repo, and repo_b.
3. Draft a balanced comparison from both gather packs. Do not invent features.
4. brief_eval, revise once if needed, cite README / issue / path evidence per side.
