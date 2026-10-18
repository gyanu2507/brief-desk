# Route selection

Read session fields: source_kind, brief_mode, repo, repo_b, url, goal.

| source_kind | Route |
|---|---|
| auto | auto |
| github | github |
| url | url |
| compare | compare |
| corpus | corpus |
| trending | trending |
| package | package |

If the user pastes a free-form goal with owner/name or https URLs, use `auto`.
Goals about "trending on GitHub" → `trending` (or `brief_auto`, which invents trending).
"Find / recommend libraries" without a repo → `brief_github_search` via auto invent `discover`.
npm/PyPI package name in the left panel → `package` (`brief_npm_package` / `brief_pypi_package`).

Tiny yes/no clarifications about the previous answer → `followup`.

Never skip `brief_eval` after a fresh multi-step draft.
