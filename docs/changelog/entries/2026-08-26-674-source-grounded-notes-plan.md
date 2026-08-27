### Implement source-grounded meeting notes on the local acceptance branch

- **Issue:** [#674](https://github.com/metagrover/pluto/issues/674)
- **PR:** Not opened; local implementation only, not shipped.
- **Changed:** Implemented the capacity-routed writer/audit pipeline, exact source-reference labels, bounded hierarchy and repair, terminology provenance checks, shared run ownership, atomic publication, title/edit/history protection, and separately retryable secondary intelligence.
- **Why:** Mandatory local topic fragmentation, missed commitments, narrative factual errors, stale edit overlays, and secondary-task delays require a coordinated pipeline and publication change.
- **Direction:** Accuracy and reliability are release gates; latency is measured, not a blocker. The approved revision replaces patch/verdict audit with a complete source-based editor, but that editor remains an internal opt-in prototype until real-provider semantic acceptance passes. Preserve the configured model and original transcript, and publish reviewed notes before secondary intelligence.
- **Replaced:** The proposed architecture-selection experiment with an approved implementation direction and a source-grounded verification plan.
- **Verification:** Latest unpromoted checkpoint: 227 unit/DOM files and 2,237 tests passed, with typecheck and scoped Biome passing. Real-provider editor cases still miss conditional commitments and retain unsupported/stale claims; reasoning and draft-label-stripping experiments did not resolve them. The former 30-second gate is superseded. No editor long-source or rendered-app acceptance is claimed. See the plan for exact failures and remaining gates.
- **Notes:** Code is implemented locally, not delivered to the running app. Model settings, stored meeting notes, and unrelated main-checkout work are unchanged. The existing inline status treatment preserves notes during regeneration and reports independent secondary failure without a UI redesign.
