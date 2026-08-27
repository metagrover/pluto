### Implement source-grounded meeting notes on the local acceptance branch

- **Issue:** [#674](https://github.com/metagrover/pluto/issues/674)
- **PR:** Not opened; local implementation only, not shipped.
- **Changed:** Implemented the capacity-routed writer/audit pipeline, exact source-reference labels, bounded hierarchy and repair, terminology provenance checks, shared run ownership, atomic publication, title/edit/history protection, and separately retryable secondary intelligence.
- **Why:** Mandatory local topic fragmentation, missed commitments, narrative factual errors, stale edit overlays, and secondary-task delays require a coordinated pipeline and publication change.
- **Direction:** One whole-conversation writer and one source-grounded audit when inputs fit; bounded source-linked hierarchy otherwise. Preserve the configured model and original transcript, and publish reviewed notes before secondary intelligence.
- **Replaced:** The proposed architecture-selection experiment with an approved implementation direction and a source-grounded verification plan.
- **Verification:** 222 unit/DOM files and 2,072 tests passed; typecheck, scoped Biome, changelog validation and commit audit hooks passed after final integration fixes. Synthetic real-provider acceptance is not yet passing, the 30-second small-fixture gate is unchanged, and no live rendered-app pass is claimed. See the plan verification matrix for measured failures and unperformed checks.
- **Notes:** Code is implemented locally, not delivered to the running app. Model settings, stored meeting notes, and unrelated main-checkout work are unchanged. The existing inline status treatment preserves notes during regeneration and reports independent secondary failure without a UI redesign.
