# Route: package

1. Call **brief_npm_package** or **brief_pypi_package** once with the session package name.
2. Draft from registry evidence only: latest version, license, description, key deps, linked repo/homepage.
3. Cite the registry URL (and repo URL if present). Optional follow-up: map GitHub repo → brief_repo_overview.
4. **brief_eval**, revise once if pass=false.

Do not invent download counts or stars. If the package is not found, say so and suggest checking the name (scoped npm needs `@scope/name`).
