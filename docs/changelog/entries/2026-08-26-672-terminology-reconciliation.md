### Reconcile unfamiliar meeting terminology safely

- **Issue:** [#672](https://github.com/metagrover/pluto/issues/672)
- **PR:** Pending.
- **Changed:** Local multi-pass analysis now discovers bounded terminology candidates, runs one conservative reconciliation pass, supplies independently supported aliases to note synthesis and grounding, and persists a versioned meeting-scoped terminology artifact. The shared notes prompts also preserve coverage, modality, evidence-close commitments, and coherent topic boundaries.
- **Why:** Unfamiliar names and domain terms could remain inconsistent in notes or cause otherwise supported commitments to be removed, while prompt-only correction risked silently guessing.
- **Replaced:** Ad hoc terminology inference inside synthesis and stale generation provenance after manual note regeneration.
- **Notes:** Canonical transcripts and quoted evidence remain unchanged. Unsupported terminology stays raw, reconciliation failures are safe no-ops, and successful regeneration now persists returned provider/model/path/version/timestamp/error metadata while clearing stale processing state.
