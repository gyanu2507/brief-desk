# Route: auto

1. Prefer **brief_auto** once with the full goal (it may include web search when useful).
2. If `brief_auto` is missing: **brief_plan** once, then **brief_orchestrate** once.
3. If gather is empty and the goal needs public facts, call **brief_web_search** once.
4. Draft immediately from gather. Address each subgoal in short bullets.
5. **brief_eval**, revise once if pass=false, then answer.
6. First line: `Plan: <source> · <mode> · <targets>`.

Do not gather twice. Ask at most one clarifying question if there is no repo/URL and no corpus/web hits.
