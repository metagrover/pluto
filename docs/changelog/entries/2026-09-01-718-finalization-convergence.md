### Make meeting finalization converge before downstream work

- **Issue:** [#718](https://github.com/metagrover/pluto/issues/718)
- **PR:** Direct `master` delivery requested by the owner.
- **Changed:** Startup now classifies evidence-free orphan v3 journals as empty before attempting checkpoint repair, and both retry validation and Parakeet finalization validate canonical v2 trust envelopes before persistence.
- **Why:** Repeated orphan recovery failures and rejected transient save payloads made healthy startup state indistinguishable from active recording loss and left no durable evidence of which meeting transition failed.
- **Replaced:** Retrying impossible empty journals on every launch, relying only on the database to discover malformed producer payloads, and logging a save stack without content-free meeting/run context.
- **Trust boundary:** Recoverable journals and explicit `needs_attention` meetings remain fail-closed. The database still rejects invalid trust state, and downstream notes or intelligence cannot begin until canonical transcript commit succeeds.
- **Notes:** Failure diagnostics contain identifiers, transition class, validation reason, and rollback outcome but never titles, transcript text, or generated notes.
