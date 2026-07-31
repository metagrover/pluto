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
readable through their existing compatibility paths. For v3,
`CaptureJournalManifestBase.lifecycleState` is widened to include `stopping`;
the v1/v2 parsers retain their original `recording | sealed` restriction.

```ts
type CaptureJournalManifestV3 = CaptureJournalManifestBase & {
  schemaVersion: 3;
  lifecycleState: 'recording' | 'stopping' | 'sealed';
  generation: string;
  revision: number;
  expectedSources: Array<'mic' | 'system'>;
  sourceAvailability: Record<
    'mic' | 'system',
    'available' | 'unavailable_at_start' | 'failed_during_capture'
  >;
  intervals: CaptureIntervalLedgerEntry[];
  activityEvidence?: CaptureActivityEvidence;
  transcriptCheckpoints: CaptureTranscriptCheckpointRef[];
  acceptanceFrames: CaptureTranscriptAcceptanceFrame[];
};

type CaptureTranscriptCheckpointRef = {
  source: 'mic' | 'system';
  sequence: number;
  chunkChecksumSha256: string;
  chunkStartSec: number;
  chunkEndSec: number;
  transcriptionConfigKey: string;
  transcriptChecksumSha256: string;
  revision: number;
  disposition:
    | 'transcribed'
    | 'verified_silence'
    | 'conversion_failed'
    | 'transcription_failed'
    | 'cancelled';
  relativePath: string;
};

type CaptureTranscriptAcceptanceFrame = {
  sequence: number;
  micCheckpointChecksumSha256: string | null;
  systemCheckpointChecksumSha256: string | null;
  arbitrationVersion: 'chunk_arbitration_v1';
  activityEvidenceDigestSha256: string;
  acceptedChecksumSha256: string;
  relativePath: string;
};

type CaptureIntervalLedgerEntry = {
  sequence: number;
  chunkStartSec: number;
  chunkEndSec: number;
  sources: Record<
    'mic' | 'system',
    | { disposition: 'pending' }
    | {
        disposition: 'raw_durable';
        rawChecksumSha256: string;
        rawRelativePath: string;
        decodeDependency?: {
          anchorSequence: number;
          initializationChecksumSha256: string;
        };
      }
    | {
        disposition: 'captured';
        rawChecksumSha256: string;
        rawRelativePath: string;
        repairChecksumSha256: string;
        repairRelativePath: string;
      }
    | {
        disposition:
          | 'verified_silence'
          | 'source_unavailable'
          | 'missing';
        reason: string;
      }
  >;
};
```

The interval ledger is authoritative for expected work. One interval is created
before either source append for a paired sequence, with exact shared boundaries
and both source dispositions `pending`. The tuple `(source, sequence)` is unique.
A checkpoint may be appended only after
the matching audio entry exists. The checkpoint must copy the audio entry's
checksum and exact time interval. A manifest also contains an explicit expected
source inventory. For every expected `(source, sequence)` tuple, the ledger
must have one of these content-free dispositions: `captured`,
`verified_silence`, `source_unavailable`, or `missing`. Absence is never treated
as silence. `missing` is a capture gap; `source_unavailable` is legal only when
the source-availability state was durably established before that interval.
Only `raw_durable` and `captured` dispositions link artifacts. Missing, silence,
and unavailable dispositions exist solely in the ledger and never fabricate a
checksum, path, or receipt. At the `stopping` watermark, any remaining `pending`
tuple becomes `missing` unless that source was durably unavailable before the
interval began.

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
    languageMode: 'fixed' | 'detected';
    requestedLanguage: string | null;
    pipelineVersion: 'live_chunk_v1';
  };
  backendResult: {
    detectedLanguage: string | null;
    providerLabel: string;
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

The raw source checkpoint is not the durable representation of what the live UI
accepted. After both available source results for a sequence have resolved,
`AudioManager` runs the existing RMS/activity arbitration and duplicate pruning,
then writes an acceptance-frame sidecar containing the accepted mic/system
segments, their source-checkpoint digests, the exact activity-evidence digest,
and the arbitration algorithm version. Recovery uses acceptance frames to
rehydrate what the user saw. Raw source checkpoints remain the reusable input for
rerunning deterministic arbitration when one source is repaired or the
arbitration version changes.

The acceptance-frame sidecar embeds the exact interval-scoped, content-free
activity windows and RMS/arbitration inputs used for that decision.
`activityEvidenceDigestSha256` covers those canonical embedded bytes, not the
evolving meeting-wide activity snapshot. Once referenced, these inputs are
immutable. Later activity updates may extend evidence outside the interval but
cannot change the frame digest. Verification requires the embedded evidence to
be a byte-equivalent subset of the final sealed activity evidence for the same
interval and producer version. A mismatch invalidates only the acceptance frame
and reruns arbitration from verified raw checkpoints plus sealed interval
evidence; it does not force transcription.

Acceptance-frame timestamps are meeting-relative and clipped to the half-open
interval `[chunkStartSec, chunkEndSec)`. A segment crossing the right boundary is
owned by the earlier sequence and clipped there; the next sequence may contain
only the non-overlapping suffix. Word timestamps receive the same clipping and
empty words are removed. Stable identity is
`sha256(source + sequence + normalizedStartMicros + normalizedEndMicros +
normalizedText)`. Cumulative fallback output is converted from meeting-relative
to chunk-relative time before writing a raw checkpoint and is clipped using the
same ownership rule. The live UI and recovery both consume the acceptance-frame
normalizer, so boundary behavior cannot diverge.

### Canonical transcription configuration

The pre-transcription configuration key is calculated from UTF-8 bytes of RFC
8785 JSON canonicalization over exactly these fully resolved compatibility keys,
in lexical key order:

`backend`, `computeType`, `device`, `languageMode`, `requestedLanguage`, `model`,
`pipelineVersion`, and `preset`.

`languageMode` is `fixed` or `detected`. `requestedLanguage` is the normalized
lowercase BCP-47 tag for fixed mode and `null` for detected mode. A detected-mode
checkpoint is reusable under the same detected-mode compatibility key without
rerunning Whisper. The backend's normalized lowercase BCP-47 result is stored per
checkpoint as `backendResult.detectedLanguage`; it is output metadata, not an
input to the key. A later fixed-language request uses a different key and
invalidates the checkpoint. Device, model, preset, and compute type are resolved
before dispatch, not requested aliases. Unknown or absent compatibility values
make the checkpoint non-reusable.

### Recording generation and manifest revision

`generation` is a random recording-session token created with the journal.
`revision` starts at zero and increments for every successful manifest mutation.
Every audio append returns an immutable receipt:

```ts
type CaptureAudioReceipt = {
  meetingId: string;
  generation: string;
  manifestRevision: number;
  source: 'mic' | 'system';
  sequence: number;
  checksumSha256: string;
  chunkStartSec: number;
  chunkEndSec: number;
  repairAudioRelativePath: string | null;
};
```

Checkpoint and acceptance mutations require the receipt, generation, and expected
manifest revision. The main process performs compare-and-swap under the existing
per-journal mutation serializer. A stale revision is retried only after rereading
the manifest and proving the identical audio receipt still exists. A stale
generation, sealed lifecycle, cancelled meeting, changed receipt, or superseded
checkpoint fails without mutation.

### Independently repairable audio

New v3 microphone and system entries retain their current durable raw capture
artifact and also produce a canonical mono PCM WAV repair artifact for that exact
interval before the entry becomes `repair_ready`. The WAV checksum/path are part
of the audio entry and receipt. Live transcription reads the same repair artifact.

If the app crashes after raw capture durability but before WAV conversion,
recovery attempts conversion of that exact raw chunk. A WebM continuation chunk
records the checksum of its initialization dependency and the smallest preceding
anchor sequence needed for decoding. Recovery may decode only the bounded range
from that anchor through the affected sequence, emit separate interval WAVs, and
then repair only unresolved transcript tuples. V3 writers must create an
independently decodable anchor at least every two sequences; if the dependency
range is missing or corrupt, the affected interval is a capture-repair failure
and cannot be hidden by transcript checkpoints. Full-session transcription is
not the fallback for a new v3 decode failure.

The raw/WAV transition is itself durable:

1. CAS a shared interval into the ledger with both sources `pending`.
2. Write and sync one source's raw artifact.
3. CAS that tuple to `raw_durable`, including raw checksum/path and any decode
   dependency. Recovery now owns the artifact.
4. Write and sync the interval repair WAV.
5. CAS the tuple from `raw_durable` to `captured`, adding repair checksum/path.
6. Return the immutable audio receipt. Only `captured` tuples are eligible for
   transcription.

A crash before step 3 leaves an ignored raw orphan. A crash after step 3 resumes
conversion from the referenced raw artifact. A crash after WAV sync but before
step 5 leaves a WAV orphan and retries conversion/CAS idempotently. Every
transition requires current generation, expected manifest revision, and exact
prior tuple disposition. Seal is illegal while any tuple remains `pending` or
`raw_durable`.

### Write ordering and atomicity

For each source chunk:

1. CAS the interval ledger entry with both expected source tuples `pending`.
2. Append and durably sync each raw artifact, then CAS its tuple to
   `raw_durable`.
3. Produce and sync each interval repair WAV, CAS its tuple to `captured`, then
   return the immutable audio receipt.
4. Transcribe the repair WAV under the receipt's generation.
5. Write the sidecar to a temporary file in the checkpoint directory.
6. Sync the temporary file.
7. Rename it to its deterministic final path.
8. Sync the checkpoint directory.
9. Compare-and-swap the checkpoint reference into a newly written manifest.
10. After both source dispositions resolve, persist the acceptance frame through
   the same sidecar/fsync/rename/manifest-CAS protocol.
11. Sync the manifest and journal directory using the existing atomic manifest
   replacement protocol.

A crash before manifest CAS leaves an unreferenced sidecar, which recovery ignores and
cleanup may remove. A manifest may never reference a missing or unsynced sidecar.
Appending the same valid `(source, sequence)` checkpoint is idempotent. A
different initial checkpoint for the same tuple is a conflict.

Coverage repair creates revision `prior.revision + 1` and must compare-and-swap
against the prior checkpoint checksum, current generation, and manifest revision.
The old reference is replaced only after the new sidecar is durable. The manifest
retains content-free `repairAttempted: true` evidence for that tuple, so coverage
repair can happen at most once. A crash before CAS leaves an orphan; a crash after
CAS makes the new revision authoritative. Cleanup removes superseded/orphan
sidecars only after canonical transcript commit.

### Journal lifecycle

The legal lifecycle is:

```text
recording -> stopping -> sealed
```

- `recording`: accepts new audio receipts, checkpoints, and acceptance frames for
  the current generation.
- `stopping`: rejects new audio capture but accepts completions for receipts
  authorized before the transition plus generation-guarded repair mutations.
- `sealed`: immutable. It contains final activity evidence, source inventory,
  tuple dispositions, checkpoint set, and acceptance frames.

The `recording -> stopping` transition records the highest authorized sequence
per source and freezes the generation. Only receipts at or below those watermarks
may complete. Seal is legal only after all expected tuples have a disposition and
all repair work has either completed or produced an explicit failure.

## Live Capture Integration

`AudioManager` persists the raw transcription result for each source, then
persists the accepted/arbitrated acceptance frame before publishing that frame to
the UI. A frame is never shown as confirmed before its manifest reference is
durable.

A checkpoint is eligible for persistence when:

- its matching audio journal append succeeded;
- transcription returned a structurally valid result, including an empty segment
  array for a successfully processed silent chunk;
- the transcription configuration is fully resolved; and
- its receipt belongs to the current generation and is authorized by the
  `recording` or `stopping` watermark; and
- the meeting has not been superseded or cancelled.

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

An empty checkpoint is legal only for `verified_silence` or a successful Whisper
response with no segments. `verified_silence` requires source-appropriate durable
activity below the existing speech threshold for the entire interval.
`source_unavailable`, conversion failure, Whisper error, cancellation, timeout,
and retry exhaustion are distinct dispositions and cannot create a successful
empty checkpoint. A successful empty Whisper response becomes under-covered when
durable activity evidence shows speech in that interval.

Coverage repair may add a chunk to the repair set once even when a structurally
valid checkpoint exists. If the replacement still fails the coverage gate, the
meeting enters the explicit #556 attention state. Pluto must not loop or expand
automatically to full-session transcription.

## Clean Stop

Clean finalization uses the same verifier and repair service as interrupted
recovery:

1. Stop creation of new jobs and transition the current generation to
   `stopping`, recording source watermarks.
2. Drain authorized audio appends.
3. Await already-authorized transcription/acceptance work within the bounded
   finalization deadline.
4. Freeze and persist final activity evidence.
5. Verify durable checkpoints and tuple dispositions.
6. Repair only unresolved tuples while the journal is `stopping`.
7. Assemble and reconcile the canonical transcript.
8. Run the deterministic integrity gate.
9. Seal the complete journal. No further checkpoint mutation is possible.
10. Compare-and-swap the canonical transcript, lifecycle projections, v2
    validation proof, finalization generation, and downstream analysis claim in
    one database transaction.
11. Start downstream analysis only when that transaction reports that this run
    acquired the claim.

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

### Recovery routing

| Journal / meeting state | Recovery behavior |
| --- | --- |
| `recording`, no meeting | Treat as interrupted; transition generation to `stopping`, set observed watermarks, finish dispositions/repair, then seal |
| `stopping`, no meeting | Resume the same generation from manifest revision |
| `sealed`, no meeting | Rehydrate and attempt the database finalization CAS |
| sealed + provisional recovered meeting | Resume only if meeting generation/proof still matches the journal and no newer retry lease exists |
| sealed + `validating` | Do not start another run; expiry/startup repair follows #556 |
| sealed + `validated` | No transcript mutation; start analysis only if the same validation proof has an unclaimed downstream state |
| cancelled/deleted meeting | Abort and clean only meeting-scoped orphans; never recreate |
| downstream processing | Preserve proof and obey `downstream_processing_json` run ownership |

The current “skip sealed journal when a non-recovery-required meeting exists”
rule is replaced by this table for v3. V1/v2 keep their compatibility routing.

### Atomic #556 handoff

Add one database command whose transaction predicate includes meeting ID,
journal generation, expected current `transcript_status`, expected validation
run ID when present, and absence of a newer validation proof:

```ts
finalizeCheckpointTranscript({
  meetingId,
  journalGeneration,
  expectedTranscriptStatus,
  expectedValidationRunId,
  canonicalTranscriptJson,
  transcriptIntegrityJson,
  transcriptValidatedAt,
  downstreamRunId,
}): 'committed_and_claimed' | 'already_committed' | 'superseded';
```

On commit it atomically writes the canonical transcript, all lifecycle
projections, validation timestamp/proof, finalized status, and
`downstream_processing_json = processing` bound to that exact proof and
`downstreamRunId`. A uniqueness predicate on the proof timestamp/run binding
ensures only the committed run may generate analysis. `already_committed` is
idempotent and may resume only the same downstream run; `superseded` performs no
work. Analysis persistence retains the existing proof/run compare-and-swap.

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
- Browser IPC fallback does not emulate v3 durability. In browser mode, v3
  recording is disabled with a safe capability result and the existing
  non-durable demo behavior remains explicitly non-production. IPC types and
  fallback tests must make this distinction observable.

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
| `src/utils/browserIpcFallback.ts` | Return explicit unsupported capability for v3 durability |
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
13. Reject stale generation/revision checkpoint completions.
14. Compare-and-swap an under-coverage replacement and retain one-attempt evidence.
15. Normalize cumulative/sliced timestamps without boundary duplication.
16. Distinguish silence, source unavailable, conversion failure, cancellation,
    and retry exhaustion.

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
8. Stop during transcription accepts only pre-watermark completions before seal.
9. A completion racing seal cannot mutate a sealed journal.
10. Cancellation followed by a stale completion performs no mutation.
11. Crash before and after under-coverage replacement CAS selects exactly one
    authoritative revision.
12. WebM continuation repair uses only its bounded anchor range.
13. Missing system tuple classification cannot be inferred as silence.
14. Existing provisional recovery resumes without overwriting a newer validation
    lease.
15. Canonical transcript/proof/downstream claim commits exactly once.

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
