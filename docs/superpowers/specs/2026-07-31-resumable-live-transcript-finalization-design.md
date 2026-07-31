# Resumable Live Transcript Finalization Design

**Issue:** #442  
**Depends on:** #445, #556  
**Status:** Owner-approved direction; awaiting independent written-spec review

## Outcome

Pluto must treat accepted live transcript chunks as durable local work. A clean
stop or interrupted-journal recovery reuses every verified chunk and transcribes
only missing, corrupt, incompatible, or demonstrably under-covered intervals.
A healthy fully checkpointed recording reaches the standard meeting analysis
without any full-session Whisper transcription.

## Verified Current State

As verified on 2026-07-30:

- `src/components/AudioManager.tsx` stores accepted live transcript segments in
  `processedMicSegmentsRef` and publishes them to the recording UI. The accepted
  segments are lost when the renderer exits.
- `electron/captureJournal.ts` durably stores checksummed microphone and system
  audio chunks plus content-free activity evidence. It has no transcript
  checkpoint representation.
- `electron/captureJournalRecovery.ts` reconstructs source audio, then explicitly
  creates an empty transcript payload.
- `src/services/recordingTranscriptValidation.ts` unconditionally transcribes all
  available full-session sources. The existing unit contract explicitly expects
  mic, mix, and system transcription.
- `src/services/retryMeetingTranscriptValidation.ts` receives zero provisional
  segments for interrupted-journal recovery and therefore repeats all recovered
  source work.

A content-free local reproduction contained 34 contiguous microphone chunks and
34 contiguous system chunks, with both reconstructed channels covering 1001.215
seconds. Live transcription had been visible during recording, but recovery
discarded it, performed full-source transcription, and ended with
`required_source_failed` and `channel_duration_mismatch`.

## Root Cause

Pluto has two incompatible units of durability:

1. Audio capture durability is chunk-based and crash-safe.
2. Transcription durability is meeting-based and exists only after finalization.

The live transcript sits between them as renderer memory. The validation service
therefore cannot distinguish already completed live work from absent work. It
re-runs Whisper over complete recordings and calls that second pass validation,
even though the integrity gate ultimately measures structural source success,
duration, activity coverage, and attribution ambiguity rather than lexical
correctness.

## Design Principles

1. **Audio remains the source of recovery truth.** Transcript checkpoints never
   replace checksummed audio artifacts.
2. **Completed local work is durable.** Once a live chunk is accepted, a crash
   must not force Pluto to repeat it.
3. **Validation is deterministic and structural.** Journal continuity, checksum
   linkage, schema/config compatibility, and activity coverage determine whether
   a checkpoint is reusable.
4. **Repair is interval-scoped.** Whisper runs only for chunks whose reusable
   transcript evidence is absent or invalid.
5. **Full-session processing is evidence-triggered.** Mix transcription and
   diarization remain fallbacks for explicit ambiguity, pass-through, or
   attribution failure.
6. **Transcript content stays private.** Text is stored only in local transcript
   sidecars and the canonical meeting transcript. Integrity envelopes, logs,
   telemetry, issues, and committed fixtures remain content-free.
7. **Trust-state authority remains unchanged.** The v2 transcript-trust envelope
   from #556 remains the authoritative lifecycle/cause/proof record.

## Durable Checkpoint Contract

### Journal schema

Introduce capture-journal schema version 3. Existing v1/v2 journals remain
readable through their existing compatibility paths.

```ts
type CaptureJournalManifestV3 = CaptureJournalManifestBase & {
  schemaVersion: 3;
  activityEvidence?: CaptureActivityEvidence;
  transcriptCheckpoints: CaptureTranscriptCheckpointRef[];
};

type CaptureTranscriptCheckpointRef = {
  source: 'mic' | 'system';
  sequence: number;
  chunkChecksumSha256: string;
  chunkStartSec: number;
  chunkEndSec: number;
  transcriptionConfigKey: string;
  transcriptChecksumSha256: string;
  relativePath: string;
};
```

The tuple `(source, sequence)` is unique. A checkpoint may be appended only after
the matching audio entry exists. The checkpoint must copy the audio entry's
checksum and exact time interval.

### Transcript sidecar

Each checkpoint points to one local JSON sidecar under the meeting capture
journal:

```ts
type CaptureTranscriptCheckpointV1 = {
  schemaVersion: 1;
  meetingId: string;
  source: 'mic' | 'system';
  sequence: number;
  chunkChecksumSha256: string;
  chunkStartSec: number;
  chunkEndSec: number;
  transcriptionConfig: {
    backend: string;
    preset: string;
    model: string;
    device: string;
    computeType: string;
    language: string;
    pipelineVersion: 'live_chunk_v1';
  };
  segments: Array<{
    start: number;
    end: number;
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
  }>;
};
```

`transcriptionConfigKey` is the SHA-256 digest of a canonical JSON encoding of
`transcriptionConfig`. `transcriptChecksumSha256` is the SHA-256 digest of the
exact sidecar bytes.

Sidecar segments use chunk-relative timestamps. Every segment must have finite
timestamps, `0 <= start < end`, `end <= chunkDuration + 0.25`, non-empty text,
and optional words satisfying the same ordering and bounds.

### Write ordering and atomicity

For each source chunk:

1. Append and durably sync the audio artifact.
2. Transcribe the chunk.
3. Write the sidecar to a temporary file in the checkpoint directory.
4. Sync the temporary file.
5. Rename it to its deterministic final path.
6. Sync the checkpoint directory.
7. Append the checkpoint reference to a newly written manifest.
8. Sync the manifest and journal directory using the existing atomic manifest
   replacement protocol.

A crash before step 7 leaves an unreferenced sidecar, which recovery ignores and
cleanup may remove. A manifest may never reference a missing or unsynced sidecar.
Appending the same valid `(source, sequence)` checkpoint is idempotent. A
different checkpoint for the same tuple is a conflict and must not overwrite the
accepted one.

## Live Capture Integration

`AudioManager` persists the raw transcription result for each source before
speaker arbitration mutates or combines it. UI publication remains based on the
existing accepted/arbitrated segments.

A checkpoint is eligible for persistence when:

- its matching audio journal append succeeded;
- transcription returned a structurally valid result, including an empty segment
  array for a successfully processed silent chunk;
- the transcription configuration is fully resolved; and
- the meeting has not been stopped, superseded, or cancelled.

If checkpoint persistence fails, Pluto keeps recording audio, marks capture
durability warning state, and records a content-free checkpoint durability
failure for finalization. It does not claim speech loss and does not log text.

## Checkpoint Verification and Rehydration

Introduce a pure verifier that accepts a parsed journal, expected transcription
configuration, and sidecar bytes. It returns:

```ts
type TranscriptCheckpointVerification = {
  reusable: VerifiedTranscriptChunk[];
  repair: Array<{
    source: 'mic' | 'system';
    sequence: number;
    reason:
      | 'checkpoint_missing'
      | 'checkpoint_corrupt'
      | 'audio_link_mismatch'
      | 'transcription_config_changed';
  }>;
};
```

A checkpoint is reusable only when:

- the referenced audio entry exists and its artifact checksum verifies;
- source, sequence, checksum, and interval match exactly;
- its sidecar path stays under the meeting's checkpoint directory;
- its sidecar checksum verifies;
- its schema and every segment parse strictly;
- its `meetingId` matches the journal;
- its transcription configuration key equals the current resolved configuration.

Unknown schema versions, fields that drive actions but do not parse, duplicate
tuples, path escapes, non-finite numbers, checksum mismatches, and conflicting
references are rejected. Rejection is isolated to the affected chunk unless the
manifest itself is structurally unsafe.

Verified sidecar segments are converted to meeting-relative timestamps using the
audio entry's `chunkStartSec`, assigned their source speaker (`Me` for mic,
`Them` for system), deduplicated by stable source/sequence/time identity, then
passed through the existing cross-channel reconciliation and attribution logic.

## Targeted Repair

The repair service operates on journal chunks, never reconstructed full-session
files:

1. Verify and rehydrate all reusable checkpoints.
2. Build the repair set from missing, corrupt, mismatched, or incompatible
   checkpoints.
3. Transcribe only the audio artifacts for those tuples, with bounded retry.
4. Persist repaired checkpoints through the same atomic append contract.
5. Re-run verification and assemble the full provisional transcript.
6. Evaluate activity coverage by source over the union of assembled segments.

An empty checkpoint is a successful transcription result for a silent chunk. It
becomes under-covered only when durable activity evidence shows speech in that
interval without transcript coverage.

Coverage repair may add a chunk to the repair set once even when a structurally
valid checkpoint exists. If the replacement still fails the coverage gate, the
meeting enters the explicit #556 attention state. Pluto must not loop or expand
automatically to full-session transcription.

## Clean Stop

Clean finalization uses the same verifier and repair service as interrupted
recovery:

1. Stop and seal audio/activity evidence.
2. Wait for already-started live chunk work within the bounded finalization
   deadline.
3. Verify durable checkpoints.
4. Repair only unresolved tuples.
5. Assemble and reconcile the canonical transcript.
6. Run the existing deterministic integrity gate.
7. Persist the v2 `validated` proof and canonical transcript atomically.
8. Start downstream analysis.

A fully checkpointed healthy meeting makes zero full-session
`WHISPER_TRANSCRIBE` calls during finalization.

## Interrupted Recovery

Recovery no longer writes an empty transcript unconditionally.

1. Verify audio entries and detect gaps as today.
2. Verify and rehydrate transcript checkpoints.
3. Persist a provisional recovered meeting containing verified checkpoint
   segments and the existing `recovered_awaiting_validation` trust cause.
4. If capture gaps exist, preserve `capture_gap_detected`; transcript checkpoints
   cannot clear missing audio.
5. If no capture gap exists, targeted repair processes only unresolved tuples.
6. Successful validation persists the canonical transcript and starts standard
   analysis.

Recovery is idempotent. Relaunching after provisional meeting persistence reuses
the same checkpoints and cannot duplicate segments or overwrite a newer
validation run.

## Full-Session Fallback

Unconditional full-source transcription is removed from
`runRecordingTranscriptValidation`.

Full-session mix transcription or diarization may run only when one of these
content-free predicates is true:

- cross-channel reconciliation exceeds the existing unresolved ambiguity
  threshold;
- pass-through evidence requires canonical mix adjudication;
- speaker attribution explicitly requests the existing acoustic fallback; or
- no chunk checkpoints exist because the journal is legacy v1/v2.

Legacy v1/v2 journals retain the current recover-from-audio path. This is a
compatibility fallback, not the path for new v3 recordings.

The fallback result cannot silently erase verified chunk work. It is reconciled
against preserved segments, and any state transition still follows the #556
trust contract.

## State and Failure Semantics

- Checkpoint persistence failure during recording: capture continues, durability
  warning becomes visible, and finalization targets the missing tuple.
- Repair transcription failure: `needs_attention` with a typed
  transcript-owned processing cause and source/stage metadata that contains no
  paths or text.
- Repair deadline: existing bounded retry timeout semantics.
- Audio gap: `capture_gap_detected` remains authoritative.
- Malformed v3 journal: fail closed as capture/finalization recovery attention;
  do not trust orphan sidecars.
- Downstream analysis failure after validation: preserve transcript validation
  proof and use `downstream_processing_json`.
- Cancellation or superseded run: stale work cannot append checkpoints, replace
  the canonical transcript, or overwrite analysis.

## Privacy and Cleanup

- Sidecars are local meeting artifacts and follow the same deletion boundary as
  audio artifacts.
- Logs may include meeting ID, source, sequence, checksums, counts, stage,
  duration, and reason enums. They must never include transcript text, word
  content, participant identity, meeting title, or artifact paths.
- Issues, changelog entries, benchmark reports, and committed fixtures use only
  synthetic content-free metadata.
- Canonical meeting deletion removes audio chunks, transcript sidecars,
  manifests, and unreferenced temporary checkpoint files.
- Cleanup never deletes a referenced checkpoint before canonical transcript and
  trust state are durably committed.

## Compatibility and Rollback

- v1/v2 journals remain readable and use the existing full-audio compatibility
  path.
- v3 readers reject unsupported future schemas without mutation.
- No database migration is required; the journal and sidecars live under the
  existing meeting artifact root.
- Reverting the feature leaves v3 journals unsupported by older code. Therefore
  rollback must retain a minimal v3 audio-entry reader that ignores transcript
  checkpoints and reconstructs audio through the legacy fallback.
- Existing canonical meetings and trust envelopes are unchanged.

## File-Level Plan

| File | Change |
| --- | --- |
| `electron/captureJournal.ts` | Add v3 manifest/checkpoint types, strict parsing, atomic checkpoint append, cleanup |
| `electron/captureJournalRecovery.ts` | Rehydrate checkpoints and persist provisional recovered transcript |
| `electron/main.ts` | Add checkpoint append/read IPC handlers with artifact-root guards |
| `src/components/AudioManager.tsx` | Persist resolved per-source chunk transcription results and finalize from checkpoints |
| `src/services/recordingTranscriptValidation.ts` | Separate deterministic validation from unconditional transcription |
| `src/services/retryMeetingTranscriptValidation.ts` | Use journal checkpoint verification/targeted repair for v3 recovery |
| `src/services/transcriptCheckpointFinalization.ts` | Pure verification, repair-set construction, assembly, and coverage orchestration |
| `src/utils/transcriptSchema.ts` | Reuse canonical payload construction for rehydrated segments |
| `tests/unit/captureJournal.test.ts` | v3 schema, durability ordering, conflicts, corrupt paths/checksums |
| `tests/unit/captureJournalRecovery.test.ts` | rehydration, idempotency, gap preservation, legacy fallback |
| `tests/unit/transcriptCheckpointFinalization.test.ts` | reuse, targeted repair, config invalidation, coverage repair |
| `tests/unit/recordingTranscriptValidation.test.ts` | replace unconditional three-source contract with deterministic gate cases |
| `tests/unit/retryMeetingTranscriptValidation.test.ts` | recovered v3 targeted repair and stale-run behavior |
| `docs/decisions.md` | Record durable transcript checkpoint as the finalization unit |
| `docs/changelog/entries/` | Add #442/PR traceability and user-visible outcome |

## TDD and Verification

### Unit tests

1. Strictly parse valid v3 manifests and sidecars.
2. Reject path traversal, unsupported versions, duplicate tuples, non-finite
   timestamps, interval mismatch, audio checksum mismatch, and sidecar checksum
   mismatch.
3. Prove audio append precedes checkpoint manifest reference.
4. Prove idempotent identical append and conflicting duplicate rejection.
5. Rehydrate a fully checkpointed synthetic meeting with zero transcription
   calls.
6. Repair exactly one missing microphone checkpoint with one microphone chunk
   transcription call and no other calls.
7. Repair exactly one corrupt system checkpoint with one system chunk call.
8. Invalidate only checkpoints whose transcription configuration changed.
9. Treat an empty silent checkpoint as complete.
10. Target one under-covered active interval once, then stop fail-closed if it
    remains under-covered.
11. Preserve capture-gap precedence.
12. Preserve stale-run and cancellation protection.

### Integration tests

1. Crash after audio append but before sidecar write: one tuple repaired.
2. Crash after sidecar rename but before manifest reference: orphan ignored and
   safely replaced/cleaned.
3. Crash after checkpoint reference but before the next chunk: referenced work
   rehydrates exactly once.
4. Clean stop with all checkpoints: zero finalization full-session Whisper calls,
   validated canonical transcript, downstream analysis starts.
5. Interrupted v3 recovery with all checkpoints: standard analysis starts without
   full-session transcription.
6. v2 legacy recovery: current full-audio compatibility path remains available.
7. Meeting deletion removes all checkpoint artifacts without escaping the meeting
   root.

### Product verification

Using synthetic local fixtures only:

1. A healthy 16-minute v3 meeting transitions from stop/relaunch to validated
   analysis without a complete-recording retranscription.
2. The preparation state reports targeted repair only while missing work exists.
3. A fully checkpointed recovery reaches the standard analysis page after
   deterministic verification and downstream generation.
4. No transcript content appears in logs, test output, integrity JSON, or
   changelog artifacts.

Run:

- focused unit and integration suites for every changed module;
- `pnpm run lint`;
- `pnpm run test -- --run`;
- PR-tier recording-quality benchmark;
- `pnpm run changelog:check`;
- `git diff --check`.

## Acceptance Criteria

1. New recordings use a v3 capture journal with durable transcript checkpoints
   linked to exact audio entries and transcription configuration.
2. A fully checkpointed healthy meeting makes zero full-session Whisper calls at
   clean stop and interrupted recovery.
3. Missing, corrupt, incompatible, or under-covered chunks trigger only targeted
   per-chunk transcription.
4. Verified live transcript chunks survive renderer/app interruption and rehydrate
   exactly once.
5. Capture gaps remain fail-closed and cannot be cleared by transcript evidence.
6. Standard meeting analysis starts immediately after deterministic validation.
7. Legacy v1/v2 journals retain a safe full-audio compatibility path.
8. Stale, cancelled, or superseded work cannot mutate checkpoint, transcript,
   trust, or downstream analysis state.
9. Transcript text remains absent from integrity envelopes, logs, telemetry,
   issues, committed fixtures, and changelog reports.
10. All focused tests, full tests, lint, recording benchmark, changelog validation,
    and diff checks pass.

## Out of Scope

- Cloud transcription or distributed queues.
- Lexical correctness scoring or human-reference transcript benchmarking.
- New transcription models or model-quality tuning.
- Redesigning the recording workspace or standard meeting analysis page.
- Migrating historical v1/v2 journals to v3.
- Persisting partial UI hypotheses before a chunk transcription is accepted.

