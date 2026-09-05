# Private meeting-notes latency benchmark

This benchmark measures local time-to-trusted-notes without publishing generated output. It reads selected meetings from a local SQLite database in query-only mode and writes an owner-only, content-free report.

Create an ignored manifest under `.private/meeting-notes-latency.json`:

```json
{
  "schemaVersion": 1,
  "databasePath": "/absolute/path/to/pluto.db",
  "cases": [
    { "caseKey": "m15-a", "meetingId": "local-id", "durationBucket": "15m" },
    { "caseKey": "m30-a", "meetingId": "local-id", "durationBucket": "30m" },
    { "caseKey": "m45-a", "meetingId": "local-id", "durationBucket": "45m" },
    { "caseKey": "m30-b", "meetingId": "local-id", "durationBucket": "30m" }
  ]
}
```

Validate before running:

```bash
pnpm run benchmark:meeting-notes-latency:validate -- --manifest .private/meeting-notes-latency.json
```

Run isolated, repeated 30-minute, or four-case burst modes only after the configured Gemma model is warm and competing Pluto/Ollama work is stopped:

```bash
pnpm run benchmark:meeting-notes-latency -- --manifest .private/meeting-notes-latency.json --mode isolated --output .artifacts/meeting-notes-latency/isolated.json
pnpm run benchmark:meeting-notes-latency -- --manifest .private/meeting-notes-latency.json --mode repeat-30 --output .artifacts/meeting-notes-latency/repeat-30.json
pnpm run benchmark:meeting-notes-latency -- --manifest .private/meeting-notes-latency.json --mode burst --output .artifacts/meeting-notes-latency/burst.json
```

To measure the experimental hierarchy that replaces leaf and intermediate model audits with deterministic source/commitment checks, use a manifest containing exactly one case and opt in explicitly:

```bash
pnpm run benchmark:meeting-notes-latency -- --manifest .private/one-meeting.json --mode isolated --hierarchy-audit-strategy final_only --output .artifacts/meeting-notes-latency/final-only.json
```

This flag affects the private benchmark only. Product generation retains an audit at every hierarchy node. Do not promote the experiment unless the case publishes and separately passes the existing source-grounded semantic quality gate.

To measure the writer and merge stages with deterministic validation only and no model audit calls, use the same single-case constraint:

```bash
pnpm run benchmark:meeting-notes-latency -- --manifest .private/one-meeting.json --mode isolated --hierarchy-audit-strategy deterministic_only --output .artifacts/meeting-notes-latency/deterministic-only.json
```

This is also benchmark-only. It retains the strict output parser, allowed-source checks, commitment guardrails, and deterministic action/decision owner and deadline grounding. It does not claim semantic equivalence to the audited product path.

To measure the smaller direct-writer response contract, add
`--compact-writer-contract` to that deterministic-only command. The compact
contract limits each item to its kind, text, and at most three source labels;
code derives title evidence, overview, owner, and deadline. It deliberately
fails instead of entering the hierarchy when the direct request does not fit.
Do not combine it with another audit strategy or treat a schema-valid result as
semantic acceptance.


Reports contain opaque case keys, source counts, planned leaf and generated-node counts, writer/audit/merge and terminal-outcome counts, aggregate stage timings, repair/repartition counts, status, and stable error categories. They exclude meeting IDs, database paths, transcript text, prompts, generated notes, titles, speakers, source spans, audio paths, raw provider responses, and individual stage payloads.

To summarize the newest 100 organic attempts without reading meeting content:

```bash
PLUTO_DB_PATH="/absolute/path/to/pluto.db" pnpm run report:meeting-notes-latency
```

The schema-v2 organic report distinguishes attempt count from distinct-meeting count, shows the maximum attempts concentrated on one meeting, counts terminal failure codes and truncated stages, and calculates latency only from published attempts. Meeting and run identifiers are used only for in-memory grouping and are never printed. Databases created before stable failure-code persistence remain readable; their historical failure-code counts are empty rather than inferred from raw errors.

Buckets with fewer than three attempts report `not_enough_evidence` rather than claiming a representative measurement. A bucket can have many attempts but only one distinct meeting; that concentration must be reported and must not be described as evidence across a corpus.

Automatic production generation is capped at two failed attempts for the same current transcript, eligibility state, and user notes across app restarts. A source or user-note revision restores automatic eligibility. Manual retry remains available and does not consume the automatic-attempt budget.
