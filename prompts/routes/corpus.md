# Route: corpus

When source_kind=corpus:

1. Call brief_corpus for the bundled local sample docs (no GitHub required).
2. You may still call brief_orchestrate without external sources if the question is corpus-shaped.
3. Draft from corpus hits only, then brief_eval. Say when the sample does not cover the ask.
