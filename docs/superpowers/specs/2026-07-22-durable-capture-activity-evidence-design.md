# Durable Capture Activity Evidence

**Issue:** [#445](https://github.com/metagrover/pluto/issues/445)

**Roadmap:** [#446](https://github.com/metagrover/pluto/issues/446)

**Status:** Proposed design independently reviewed; written spec pending separate review

## Outcome

Initial transcript validation, crash recovery, and every retry use the same immutable content-free capture-activity evidence. A crash can lose only an unacknowledged tail; it cannot silently replace capture-time evidence with provisional transcript segments.

## Current Gap

Pluto builds `StoredTranscriptActivityEvidence` from the renderer's in-memory speaker timeline after final transcription. It persists that object inside the final meeting integrity record, and retry code can reuse it. The capture journal stores durable mic/system chunks but no activity evidence. If the renderer or app exits before the final meeting save, launch recovery reconstructs acknowledged audio without the original activity timeline.

The existing capture-journal append queue also catches write failures to keep recording alive. Draining the queue therefore does not prove every prior append succeeded. The new evidence path must not allow a swallowed audio or evidence write failure to produce a sealed or validated meeting.

## Chosen Approach

Persist an incremental, canonical capture-activity envelope in capture-journal schema v2. Each closed speaker window schedules a durable evidence snapshot through the same ordered journal-write boundary as audio appends. Clean stop flushes the final open window, drains all queued work, verifies that no prior write failed, and seals the exact latest durable envelope. The seal result returns that frozen payload and digest; downstream stages never rebuild it from mutable renderer state.

Rejected alternatives:

- **Seal-only snapshot:** smaller, but renderer/app failure before clean stop still loses the evidence this issue exists to preserve.
- **Recovery-time reconstruction from audio or provisional text:** changes evidence when algorithms, thresholds, or models change and cannot satisfy byte-for-byte initial/retry equivalence.
- **A separate best-effort evidence file:** creates two durability states without an atomic journal contract and can let audio sealing hide missing evidence.

## Canonical Evidence Envelope

Capture-journal v2 adds one optional-during-recording and required-when-sealed `activityEvidence` envelope:

- evidence schema version;
- source identifier `capture_activity_v2`;
- normalized closed windows with finite monotonic start/end seconds and `Me`/`Them` source labels;
- capture clock metadata defining the meeting-relative time base;
- the exact RMS/activity thresholds and algorithm/provenance version that produced the windows;
- a canonical serialization version;
- SHA-256 of the canonical payload excluding the digest field itself.

Normalization sorts windows deterministically and rejects invalid, overlapping-self-contradictory, non-finite, or negative ranges according to one pure schema parser. The serializer produces stable field order and number representation so the digest is reproducible. The envelope contains no audio, transcript text, names, participant data, meeting title, absolute paths, credentials, or private identifiers beyond the journal's existing meeting ID.

This envelope deliberately supersedes the version-1 `StoredTranscriptActivityEvidence` persistence shape for new recordings. Retry readers continue to understand legacy meeting integrity records.

## Journal Schema and Compatibility

The reader discriminates capture-journal schemas explicitly:

- **v1:** existing manifests remain readable. Evidence absence is legacy uncertainty, not corruption. Recovery marks the evidence source as legacy/missing and cannot claim capture-equivalent validation certainty.
- **v2 recording:** `activityEvidence` may be absent before the first closed activity window, but every snapshot that exists must parse and match its digest.
- **v2 sealed:** the canonical envelope and valid digest are required. Missing, malformed, unsupported, or digest-mismatched evidence fails closed with a specific content-free reason.

No code silently coerces v1 into v2 or treats a declared v2 evidence failure as legacy fallback.

## Write Ordering and Failure State

Audio appends and activity snapshots use one ordered session durability queue plus a persistent failure latch. The latch records only a content-free failure category and is never cleared during the session.

When a speaker window closes, the renderer builds the next canonical snapshot and schedules it after already queued journal work. On stop, it flushes the active speaker window at the frozen recording end time, schedules the final snapshot, and drains the queue. Seal is permitted only if the queue drained and the failure latch is clear.

Any failed audio append, evidence snapshot, final-window flush, drain, or seal produces `recovery_required`. Pluto preserves the journal and visible degraded meeting, prohibits transcript validation and normal finalization, and retains the source artifacts. A later successful write cannot erase the earlier failure.

## Data Flow

1. Capture starts a v2 journal and initializes the content-free evidence producer metadata.
2. Mic/system chunks append durably as today.
3. Each closed speaker window updates the canonical activity envelope through the ordered durability queue.
4. Stop freezes recording time, closes the active window, drains the queue, checks the failure latch, and seals the journal.
5. Seal returns the exact canonical envelope and digest read from the durable manifest.
6. Initial transcript validation consumes windows parsed from that returned envelope.
7. Meeting integrity persists the identical envelope and digest without rebuilding it.
8. Launch recovery imports the journal envelope into the recovered meeting integrity record.
9. Every retry parses the persisted envelope, validates its digest/schema, and consumes the same windows.

## Failure Semantics

- A v2 evidence failure is specific and fail-closed; it cannot fall back to provisional transcript segments.
- A v1 journal or legacy meeting remains retryable but is labeled `legacy_provisional_segments` and cannot claim equivalent certainty.
- Diagnostics use content-free categories such as `capture_activity_missing`, `capture_activity_corrupt`, `capture_activity_unsupported`, and `capture_journal_write_failed`.
- Failed journals remain recoverable on later launches. No new cleanup or retention behavior is introduced.
- Normal successful finalization behavior is otherwise unchanged.

## Components

- `src/utils/transcriptActivityEvidence.ts`: canonical v2 envelope builder, parser, serializer, digest verification, and legacy meeting compatibility.
- `electron/captureJournal.ts`: discriminated v1/v2 manifest validation, durable activity snapshot update, failure-safe seal return.
- `electron/main.ts` and preload IPC contract: content-free snapshot update and seal payload transport.
- `src/components/AudioManager.tsx`: persistent journal failure latch, ordered snapshot scheduling, final-window flush, and sealed-payload handoff to validation/persistence.
- `electron/captureJournalRecovery.ts`: v1 legacy handling and v2 envelope import with fail-closed reasons.
- `src/services/retryMeetingTranscriptValidation.ts`: canonical envelope/digest parsing for retry while retaining explicit legacy behavior.

## Testing

TDD must prove:

- canonical serialization and SHA-256 are deterministic;
- the final active speaker window appears in the sealed envelope;
- audio or snapshot write failure remains latched and cannot lead to seal, validation, or normal finalization;
- v1 journals remain readable as legacy uncertainty;
- v2 missing, malformed, unsupported, or digest-mismatched evidence fails closed with distinct reasons;
- seal returns the exact durable payload/digest;
- initial validation, meeting persistence, crash recovery, and retry observe identical payload/digest values;
- existing journal idempotency, checksum, path-boundary, durability, recovery-isolation, and retry tests remain green;
- fixtures, logs, issue updates, and committed files contain no private content or absolute paths.

Final verification includes focused activity-evidence, capture-journal, capture-recovery, recording-finalization, and retry-validation suites; recording-quality benchmark `pr` tier; changelog validation; lint; full tests; high-severity audit; and diff/privacy checks.

## Scope

In scope: durable content-free activity evidence, schema compatibility, failure propagation, sealed identity, recovery import, and deterministic retry consumption.

Out of scope: new thresholds, transcript models, retention policy, recovery UI, participant identity, telemetry, private corpora, external services, or broad AudioManager refactoring.
