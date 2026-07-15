### Count unique audio coverage when validating recording transcripts

- **Issue:** [#434](https://github.com/metagrover/pluto/issues/434)
- **PR:** [#435](https://github.com/metagrover/pluto/pull/435)
- **Changed:** Recording transcript validation now measures the union of covered timeline intervals, so overlapping or duplicate transcript segments count each captured second only once.
- **Why:** Summed overlaps could inflate partial speech coverage enough to mark an incomplete transcript as validated.
- **Replaced:** Per-segment overlap summation that counted the same audio interval repeatedly.
- **Notes:** Validation thresholds are unchanged, and the regression fixture contains only synthetic transcript data.
