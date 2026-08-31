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

Reports contain opaque case keys, source counts, planned leaf and generated-node counts, writer/audit/merge and terminal-outcome counts, aggregate stage timings, repair/repartition counts, status, and stable error categories. They exclude meeting IDs, database paths, transcript text, prompts, generated notes, titles, speakers, source spans, audio paths, raw provider responses, and individual stage payloads.

To summarize the newest 100 organic runs without reading meeting content:

```bash
PLUTO_DB_PATH="/absolute/path/to/pluto.db" pnpm run report:meeting-notes-latency
```

Buckets with fewer than three samples report `not_enough_evidence` rather than an average.
