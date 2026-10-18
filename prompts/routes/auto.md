# Route: auto

When source_kind=auto (or the user gives only a free-form goal):

1. Call **brief_auto** once with the full goal text (not brief_plan + brief_orchestrate separately).
2. Read invented fields, subgoals, and gather from the result.
3. Draft the brief immediately from gather. Address each subgoal in a few bullets.
4. Call brief_eval. If pass=false, revise once, then send the final answer.
5. Open with one line naming the plan (source + mode + targets).

Do **not** call brief_workspace, brief_fetch_url, brief_repo_file, or a second orchestrate unless brief_auto returned an explicit error and gather is empty.

Do not ask the user to fill the left panel if the goal already contains owner/name or https URLs.
Ask at most one clarifying question only when brief_auto says the goal is too vague.
