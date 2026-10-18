# Route: releases

1. Call **brief_repo_release_diff** once with repo + tag_a (older) + tag_b (newer) from the session.
2. Draft a changelog-style delta: breaking changes, features, fixes. Cite both release URLs.
3. Call out upgrade risk for an eng team (migrations, peer deps, known breakages in notes).
4. **brief_eval**, revise once if pass=false.

If a tag is missing from recent releases, say so and suggest loading the releases list again.
