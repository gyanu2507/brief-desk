# Route selection

Read the active session (source_kind, brief_mode, repo, repo_b, url, goal) from context.

Pick exactly one route and follow its instructions:

| source_kind | Route file key |
|---|---|
| auto | auto |
| github | github |
| url | url |
| compare | compare |
| corpus | corpus |

If source_kind is missing or the user pastes a free-form goal with repos/URLs and no panel fields, prefer `auto`.

Tiny follow-ups (single file, one fact already in chat, yes/no clarifications) may use the `followup` route instead of re-running the full plan loop.

Never skip `brief_eval` after a fresh multi-step draft unless the user only asked a one-line clarification about the previous answer.
