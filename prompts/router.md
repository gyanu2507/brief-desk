# Route selection

Read the active session (source_kind, brief_mode, repo, repo_b, url) from context.

Pick exactly one route below and follow its instructions:

| source_kind | Route file key |
|---|---|
| github | github |
| url | url |
| compare | compare |
| corpus | corpus |

Tiny follow-ups (single file, one fact already in chat, yes/no clarifications) may use the `followup` route instead of re-running the full orchestrate loop.

Never skip `brief_eval` after a fresh multi-step draft unless the user only asked a one-line clarification about the previous answer.
