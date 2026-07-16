### Exclude checksum-mismatched capture chunks during recovery

- **Issue:** [#485](https://github.com/metagrover/pluto/issues/485)
- **PR:** [#486](https://github.com/metagrover/pluto/pull/486)
- **Changed:** Launch-time capture-journal recovery now recomputes each acknowledged chunk checksum before stitching recovered audio and records explicit `checksum_mismatch` gaps when same-size corruption is excluded.
- **Why:** Crash-safe recovery should only trust audio Pluto can prove matches the originally acknowledged artifact, even when a corrupted file still has the expected byte count.
- **Replaced:** Recovery behavior that treated byte-count equality as sufficient proof of chunk integrity.
- **Notes:** The slice stays inside the existing startup recovery path on `master`; it salvages unaffected chunks from the same journal without broadening into new recovery UI or transcript retry behavior.
