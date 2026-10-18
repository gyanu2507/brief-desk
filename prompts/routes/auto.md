# Route: auto

1. Prefer **brief_auto** once with the full goal (it may include web / trending / search when useful).
2. If `brief_auto` is missing: **brief_plan** once, then the matching gather tool(s).
3. Extra tools when needed (one shot each): **brief_web_search**, **brief_github_trending**, **brief_github_search**, **brief_npm_package**, **brief_pypi_package**, **brief_repo_releases**, **brief_repo_release_diff**, **brief_repo_security**.
4. Draft immediately from gather. Address each subgoal in short bullets.
5. **brief_eval**, revise once if pass=false, then answer.
6. First line: `Plan: <source> · <mode> · <targets>`.

Do not gather twice. Ask at most one clarifying question if there is no repo/URL and no corpus/web/trending hits.
