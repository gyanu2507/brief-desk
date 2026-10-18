# Route: auto

When source_kind=auto (or the user gives only a free-form goal):

1. Call brief_plan with the full goal text.
2. Read invented.source_kind, mode, repo, repo_b, url, subgoals, and tool_steps.
3. Execute immediately:
   - If compare: brief_orchestrate mode=compare with both repos.
   - If url: brief_orchestrate / brief_fetch_url with the URL.
   - If github: brief_orchestrate with repo + mode.
   - If corpus: brief_corpus.
4. Draft from evidence only. Address each invented subgoal briefly.
5. brief_eval, revise once if pass=false, then answer with citations.
6. Open your answer with one line naming the plan you chose (source + mode + targets).

Do not ask the user to fill the left panel if the goal already contains owner/name or https URLs.
Ask at most one clarifying question only when the plan's next field says the goal is too vague.
