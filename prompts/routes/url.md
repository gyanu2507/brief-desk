# Route: url

When source_kind=url:

1. Require a public http(s) url. Optional companion repo is allowed.
2. Call brief_orchestrate with url= (and repo= if present), mode as given (often docs).
3. You may also use brief_fetch_url for a targeted page pull.
4. Draft from fetched text only, then brief_eval. Cite the source URL.
