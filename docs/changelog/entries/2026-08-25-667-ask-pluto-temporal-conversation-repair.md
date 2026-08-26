### Keep Ask Pluto in the right date and conversation scope

- **Issue:** [#667](https://github.com/metagrover/pluto/issues/667)
- **PR:** Not created; shipped directly to `master` at the user's request.
- **Changed:** Ask Pluto now resolves relative dates before search, carries bounded conversation text plus structured scope across follow-ups, and distinguishes no-evidence and partial outcomes from grounded answers. Repeated meeting refreshes no longer duplicate FTS documents, startup repairs legacy duplicates from canonical meetings, diagnostic follow-ups no longer search unrelated older meetings, and unsupported generated claims are removed from the primary answer. Answers read like normal chat responses; supporting meetings stay behind a compact, collapsed source disclosure instead of filling the conversation with citation cards.
- **Why:** Requests such as “Summarize today’s meetings” could search for the word `today` instead of selecting today’s meetings, while a later “What went wrong here?” lost the failed request’s scope and cited unrelated history.
- **Replaced:** Literal keyword search for relative dates, citation-dependent follow-up context, duplicate FTS inserts, unsupported answer text, and the always-expanded wall of meeting citation cards.
- **Notes:** “Current meeting” still means the active recording when one exists, otherwise the most recently started persisted meeting. Temporal scopes use local half-open date ranges, and large ranges report any meeting coverage omitted from the foreground context budget.
