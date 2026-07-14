### Preserve working-memory source cursor provenance
- **Issue:** [#391](https://github.com/metagrover/pluto/issues/391)
- **PR:** [#392](https://github.com/metagrover/pluto/pull/392)
- **Changed:** Working-memory snapshots now preserve the source knowledge doc's last source cursor inside `payload.source`, with focused regression coverage for cursor-present, cursor-missing, and backward-compatible round-trips.
- **Why:** `#80` calls for durable snapshot source-window provenance so downstream consumers and debugging tools can understand which knowledge-doc window produced a snapshot. Before this slice, persisted snapshots retained the doc id and synthesis time but dropped the source cursor after storage.
- **Replaced:** Treating source provenance as limited to the source doc id and synthesis timestamp, which left snapshots unable to describe their own source window.
- **Notes:** This stays within the snapshot substrate and does not broaden into Knowledge consumer or UI changes.
