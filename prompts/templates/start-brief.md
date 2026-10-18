Run a brief-desk briefing.
source={{source}}
mode={{mode}}
{{repo_line}}
{{repo_b_line}}
{{url_line}}

Tool sequence (strict): call brief_orchestrate once with these fields (or brief_corpus if source=corpus). Draft from gather. brief_eval. Revise if pass=false. Reply with the brief.
Banned: brief_workspace and extra gather tools after the first pack.

Question: {{question}}
