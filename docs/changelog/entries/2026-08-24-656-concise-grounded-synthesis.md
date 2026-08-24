### Make local meeting synthesis concise and evidence-safe

- **Issue:** [#656](https://github.com/metagrover/pluto/issues/656)
- **PR:** Not created; committed directly to master at the user's request.
- **Changed:** Local analysis uses tighter overlapping windows, non-reasoning coverage checks, deterministic key-point caps, grounded editorial restoration, defensive title parsing, and foreground-aware knowledge-synthesis pausing.
- **Why:** Long meeting notes should shed repetition without losing explicit decisions, commitments, distinctive terminology, or transcript evidence.
- **Replaced:** An unfinished prompt experiment that shortened Pluto's extraction policy and allowed the editorial pass to erase grounded local facts.
- **Notes:** Coverage checks are discarded before persistence. Fallback analysis is presented as retryable rather than ready, and startup knowledge refreshes wait briefly to avoid immediate local-model contention.
