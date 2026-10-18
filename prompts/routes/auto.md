# Route: auto

1. Prefer **brief_auto** once with the full goal.
2. If `brief_auto` is missing from the tool list: **brief_plan** once, then **brief_orchestrate** once using invented.repo / repo_b / url / mode.
3. Draft immediately from gather. Address each subgoal in short bullets.
4. **brief_eval**, revise once if pass=false, then answer.
5. First line of the answer: `Plan: <source> · <mode> · <targets>`.

Banned after gather: brief_workspace, brief_fetch_url, brief_repo_file, second orchestrate.

Ask at most one clarifying question only if the plan says the goal has no repo/URL.
