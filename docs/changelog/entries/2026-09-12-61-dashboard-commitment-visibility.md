### Restore new dashboard commitments

- **Issue:** [#61](https://github.com/metagrover/pluto/issues/61)
- **PR:** Pending.
- **Changed:** The dashboard now treats explicit person assignment as the ownership authority, keeps distinct canonical commitments reviewable even when their wording overlaps, and shows a retryable error instead of a false empty state when identity cannot be loaded. Commitment publication no longer reuses an existing meeting action from wording overlap alone; validated semantic aliases remain the durable deduplication path.
- **Why:** Valid personal commitments were being hidden by contradictory wording-based ownership and deduplication checks, while an identity-loading failure could look like a trustworthy empty queue.
- **Replaced:** Wording overlap as an independent commitment identity authority and silent fallback to an empty dashboard state when identity loading fails.
- **Notes:** Persisted incident attribution and any evidence-backed recovery remain pending; preserve reviewed lifecycle state, provenance, and reversible aliases during follow-up recovery.
