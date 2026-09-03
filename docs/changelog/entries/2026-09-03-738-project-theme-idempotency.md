### Keep synthesized project themes singular

- **Issue:** [#738](https://github.com/metagrover/pluto/issues/738)
- **PR:** Direct `master` delivery requested by the owner.
- **Changed:** Review-generated project themes are excluded from the candidate inputs used to synthesize the next portfolio revision.
- **Why:** Linking a synthesized theme back to its evidence meetings previously changed the next synthesis fingerprint and could create another project record for the same theme.
- **Replaced:** Self-referential candidate hashing that treated Pluto's prior synthesized output as new source evidence.
- **Trust:** User-confirmed projects remain eligible identity anchors, while model output can reference only candidate IDs supplied by the filtered source set.
- **Recovery:** Existing duplicate records can be merged through Pluto's reversible project-alias mechanism without deleting meetings or evidence.
- **Verification:** A regression test feeds a saved review theme back through its source meetings and confirms that synthesis remains idempotent.
- **Notes:** The portfolio presentation is unchanged; this corrects synthesis identity and existing duplicate data.
