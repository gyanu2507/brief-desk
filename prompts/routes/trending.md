# Route: trending

1. Call **brief_github_trending** once with language/since from the session (default weekly).
2. Draft a ranked shortlist (5 to 8 repos): one line why each matters, cite trending URL + repo URLs.
3. Offer 1 to 2 picks for a deeper `brief_repo_overview` / `brief_repo_ask` follow-up.
4. **brief_eval**, revise once if pass=false.

If trending returns empty, fall back to **brief_github_search** with `created:>` recent + language.
