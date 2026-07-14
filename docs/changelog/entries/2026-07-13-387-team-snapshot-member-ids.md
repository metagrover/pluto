### Preserve team membership in working-memory tracker snapshots
- **Issue:** [#387](https://github.com/metagrover/pluto/issues/387)
- **PR:** [#388](https://github.com/metagrover/pluto/pull/388)
- **Changed:** Team-tracker working-memory snapshots now preserve `member_entity_ids` in `payload.scope`, and focused working-memory snapshot regression coverage proves the metadata survives both snapshot build and persistence round-trips while non-team scopes keep their existing payload shape.
- **Why:** `#80` depends on working-memory snapshots being durable and inspectable enough for downstream consumers, tests, and debugging. Before this slice, team-tracker snapshots persisted the scope key and title but dropped the actual team membership that defines the tracker.
- **Replaced:** Treating live knowledge-doc config as the only source of team membership metadata even after the tracker had already been persisted into durable working memory.
- **Notes:** This intentionally stays inside the snapshot substrate and does not broaden into Knowledge consumer changes or queue-backed team-tracker rendering.
