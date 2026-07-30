# Transcript Trust State Design

**Issue:** [#556](https://github.com/metagrover/pluto/issues/556)

**Parent:** [#444](https://github.com/metagrover/pluto/issues/444)

**Roadmap:** [#446](https://github.com/metagrover/pluto/issues/446), [#65](https://github.com/metagrover/pluto/issues/65)

**Status:** Approved direction; awaiting committed written-spec review

## Problem

Pluto currently stores transcript trust across several partially independent
fields:

- `meetings.transcript_status`
- `meetings.transcript_integrity_json`
- `meetings.transcript_validated_at`
- `meetings.finalization_status`
- `meetings.finalization_error_category`
- `transcript_json.lifecycleStatus`

Producers write different subsets of those fields. Consumers then infer meaning
from whichever subset they inspect.

Launch recovery demonstrates the failure. A gap-free recovered recording is
saved as `needs_attention` with recovery metadata but without transcript
coverage reasons. Meeting View maps that incomplete shape to copy claiming
Pluto could not account for captured speech. Capture recovery was successful,
but the UI presents a transcript-integrity conclusion that was never reached.

The same ambiguity permits more dangerous outcomes:

- missing state can default to `validated`;
- contradictory projections can persist;
- a malformed `validating` row can remain stuck without a usable lease;
- every ordinary attention state can appear retryable even when required
  artifacts or evidence are unavailable;
- broad processing errors can be mislabeled as source-transcription failures;
- legacy read compatibility can accidentally authorize new downstream work.

This design replaces inference with one versioned trust contract.

## Goals

1. Persist one authoritative, content-free transcript trust envelope.
2. Make every new trust-state transition structurally valid and explicit.
3. Resolve persisted state through one deterministic parser and precedence
   table before UI, retry, regeneration, or downstream generation acts.
4. Preserve existing legacy transcripts and intelligence for reading without
   treating them as proof-backed validation.
5. Distinguish capture gaps, pending validation, validation failures, retry
   failures, malformed state, and downstream processing failures.
6. Ensure a user-visible action is offered only when the same executable
   preconditions pass in the service that performs it.
7. Keep meeting content, artifact paths, and raw diagnostic codes out of UI,
   committed fixtures, logs, and GitHub.

## Non-goals

- Per-source durable transcription caching or resume from #442.
- Transcript model selection or quality-policy tuning.
- Cloud processing or external telemetry.
- A broad redesign of the recording or Meeting View surfaces.
- Destructive migration of historical meeting rows.
- Reclassifying already-generated legacy intelligence as canonically validated.

## Design Principles

- Validation is proved, never defaulted.
- Capture truth and transcript truth are separate.
- Known uncertainty survives retries until evidence resolves it.
- Unknown state fails closed without fabricating a specific failure.
- Compatibility permits reading old work, not generating new work from
  unproved state.
- User actions and service preconditions share one policy.
- Downstream processing cannot rewrite transcript trust.

## Authoritative V2 Envelope

New and rewritten recording trust state is stored in
`transcript_integrity_json` as a strictly parsed version-2 envelope.

```ts
type TranscriptTrustEnvelopeV2 = {
  schemaVersion: 2;
  state: 'provisional' | 'validating' | 'validated' | 'needs_attention';
  causes: TranscriptTrustCauseV2[];
  evidenceProvenance: TranscriptEvidenceProvenanceV2;
  activityEvidence?:
    | CaptureActivityEvidence
    | StoredTranscriptActivityEvidence;
  evidence?: TranscriptIntegrityEvidenceV2;
  validationProof?: TranscriptValidationProofV2;
  retry?: TranscriptValidationRetryLeaseV2;
  recovery?: TranscriptRecoverySummaryV2;
  restorationProof?: TranscriptCaptureRestorationProofV2;
};
```

`transcript_integrity_json` is authoritative for v2 rows.
`meetings.transcript_status`, `meetings.transcript_validated_at`, and
`transcript_json.lifecycleStatus` are projections. They exist for indexed
queries and payload compatibility, but they do not independently establish
trust.

### Causes

```ts
type TranscriptTrustCauseV2 =
  | { code: 'recovered_awaiting_validation' }
  | {
      code: 'capture_gap_detected';
      sourceScope: 'mic' | 'system' | 'multiple' | 'unknown';
    }
  | { code: 'local_transcript_coverage_low' }
  | { code: 'local_speech_unaccounted' }
  | { code: 'remote_speech_unaccounted' }
  | { code: 'deterministic_retry_evidence_missing' }
  | { code: 'deterministic_retry_evidence_corrupt' }
  | { code: 'capture_activity_missing' }
  | { code: 'capture_activity_corrupt' }
  | { code: 'capture_activity_unsupported' }
  | { code: 'capture_journal_write_failed' }
  | { code: 'required_source_failed'; sourceScope: ValidationSourceScope }
  | { code: 'channel_duration_mismatch'; sourceScope: ValidationSourceScope }
  | { code: 'ambiguous_pass_through' }
  | { code: 'validation_retry_timeout' }
  | { code: 'validation_retry_failed' }
  | { code: 'validation_retry_interrupted' }
  | { code: 'validation_state_corrupt' }
  | {
      code: 'processing_stage_failed';
      stage: TranscriptOwnedProcessingStage;
    };

type ValidationSourceScope = 'mic' | 'system' | 'mix' | 'multiple' | 'unknown';

type TranscriptOwnedProcessingStage =
  | 'capture_seal'
  | 'audio_probe'
  | 'source_transcription'
  | 'reconciliation'
  | 'integrity_gate'
  | 'canonical_save';
```

Unknown cause codes are rejected for new v2 writes. A v2 cause array contains
unique codes, except source-scoped causes may appear once per distinct source
scope. Cause objects contain no paths, transcript text, titles, participant
data, or exception messages.

Failures after canonical transcript commit do not use
`processing_stage_failed`. Analysis, value-signal, knowledge, or other derived
generation failures preserve the transcript validation proof and belong to a
separate downstream-processing state.

### Evidence provenance

```ts
type TranscriptEvidenceProvenanceV2 =
  | { kind: 'sealed_capture_activity_v2'; digestSha256: string }
  | { kind: 'stored_capture_activity_v1' }
  | { kind: 'legacy_provisional_segments' }
  | { kind: 'missing' }
  | { kind: 'corrupt' }
  | { kind: 'unsupported'; sourceVersion: string };
```

The digest is a lowercase 64-character SHA-256 value. `sourceVersion` is a
content-free identifier between 1 and 64 ASCII alphanumeric, underscore,
period, or hyphen characters.

### Durable activity evidence

The envelope embeds the existing strictly parsed `CaptureActivityEvidence`
schema from `src/utils/transcriptActivityEvidence.ts`. This preserves the
version-2 producer metadata, normalized non-overlapping activity windows, and
SHA-256 digest used by deterministic validation retry.

Legacy `StoredTranscriptActivityEvidence` version 1 may be carried only with
`evidenceProvenance.kind === 'stored_capture_activity_v1'`. New capture and
recovery producers must write `CaptureActivityEvidence` version 2.

The parser delegates to the existing evidence parsers and rejects a provenance
kind that does not match the embedded evidence. Missing, corrupt, or unsupported
evidence is represented by provenance and an explicit attention cause, never by
retaining an unparsed payload.

### Numeric evidence

```ts
type TranscriptIntegrityEvidenceV2 = {
  micActivitySeconds: number;
  systemActivitySeconds: number;
  localTranscriptCoveredSeconds: number;
  remoteTranscriptCoveredSeconds: number;
  unexplainedMicSeconds: number;
  unexplainedSystemSeconds: number;
  collapsedPassThroughSeconds: number;
  unresolvedAmbiguousSeconds: number;
};
```

Every value must be finite and non-negative. Covered seconds cannot exceed the
corresponding activity seconds beyond the validation tolerance. JSON `null`,
negative values, `NaN`, infinity, strings, and unknown keys do not parse as v2
evidence.

### Validation proof

```ts
type TranscriptValidationProofV2 = {
  gateVersion: 'canonical_integrity_v1';
  validatedAt: string;
};
```

`validatedAt` must be a valid ISO-8601 timestamp. It must equal
`meetings.transcript_validated_at`. A `validated` envelope requires proof,
empty causes, no retry lease, and projection agreement.

### Retry lease

```ts
type TranscriptValidationRetryLeaseV2 = {
  runId: string;
  startedAt: string;
  deadlineAt: string;
  stage: 'transcribing' | 'reviewing_evidence' | 'saving';
};
```

Both timestamps must be valid ISO-8601 values, and `deadlineAt` must be later
than `startedAt`. `runId` is between 1 and 128 ASCII alphanumeric or hyphen
characters. A `validating` envelope requires one valid lease, no validation
proof, empty causes, and projection agreement. Capture restoration is a
separate recovery operation and never borrows a transcript-validation lease.

### Recovery summary

```ts
type TranscriptRecoverySummaryV2 = {
  source: 'capture_journal';
  gapDetected: boolean;
  sourceScope: 'mic' | 'system' | 'multiple' | 'unknown';
  acknowledgedChunkCount: number;
  recoveredChunkCount: number;
};

type TranscriptCaptureRestorationProofV2 = {
  kind: 'capture_journal_restoration_v1';
  restoredAt: string;
  sourceScope: 'mic' | 'system' | 'multiple';
  acknowledgedChunkCount: number;
  restoredChunkCount: number;
  manifestDigestSha256: string;
};
```

Counts are finite non-negative integers, and recovered count cannot exceed
acknowledged count. The summary never persists artifact paths. When
`gapDetected` is true, `capture_gap_detected` must be present with the same
source scope.

A restoration proof is accepted only when its timestamp is valid, both counts
are equal positive integers, its digest is lowercase SHA-256, and its scope
covers the prior gap scope. The same transition updates the recovery summary to
`gapDetected: false` and removes `capture_gap_detected`. A validation proof
cannot coexist with `gapDetected: true` or a capture-gap cause. Retranscription
alone never creates restoration proof.

## Strict Parsing

The v2 parser accepts only:

- `schemaVersion === 2`;
- exactly the documented top-level keys and exactly the documented keys for
  each nested cause, proof, lease, recovery, restoration, and evidence object;
- known state, cause, stage, source-scope, gate-version, and provenance values;
- required fields for the selected state;
- valid timestamps and finite numeric evidence;
- unique causes under the rule above;
- projection-consistent values.

State-specific field rules are exact:

- `provisional`: empty causes; no proof, retry, recovery, restoration, numeric
  evidence, or embedded activity evidence; provenance is `{ kind: 'missing' }`.
- `validating`: valid retry; no validation proof; empty causes; recovery and
  evidence fields allowed only when no unresolved capture gap remains.
- `needs_attention`: non-empty causes; no retry or validation proof; recovery
  and evidence fields allowed. Restoration proof is absent while a capture-gap
  cause remains and allowed after that cause is replaced by
  `recovered_awaiting_validation`.
- `validated`: empty causes; valid proof; no retry; activity and numeric
  evidence required; no unresolved capture gap; restoration proof allowed only
  when it was established by the immediately preceding recovery transition.

Unknown keys are invalid rather than ignored. Expired retry leases remain
parseable but resolve through the expired-lease precedence path and are repaired
at startup.

Unsupported envelope versions resolve to `validation_state_corrupt`; they are
not interpreted as legacy. Legacy normalization applies only when
`schemaVersion` is absent.

The parser returns a result rather than throwing:

```ts
type ParseTranscriptTrustEnvelopeResult =
  | { ok: true; envelope: TranscriptTrustEnvelopeV2 }
  | {
      ok: false;
      failure:
        | 'invalid_json'
        | 'unsupported_schema'
        | 'invalid_shape'
        | 'projection_conflict';
    };
```

Failure values are content-free and safe for tests and diagnostics.

## Projection Invariants

Every v2 trust mutation must satisfy:

| Envelope state | `transcript_status` | Payload lifecycle | `transcript_validated_at` |
| --- | --- | --- | --- |
| `provisional` | `provisional` | `provisional` | `NULL` |
| `validating` | `validating` | `validating` | `NULL` |
| `needs_attention` | `needs_attention` | `needs_attention` | `NULL` |
| `validated` | `validated` | `validated` | exact proof timestamp |

Additional invariants:

- `needs_attention` has at least one cause and no live retry lease.
- `validated` has no causes and has a supported proof.
- `validating` has a valid lease and no causes or proof.
- `provisional` has no proof and cannot authorize derived generation.
- Capture-gap cause and recovery summary cannot contradict each other.
- A known capture gap prevents `validated` until recovery evidence proves the
  missing acknowledged intervals were restored. Transcribing the surviving
  audio cannot clear the cause.

## Legal Transitions

| From | Event | To | Required effect |
| --- | --- | --- | --- |
| none | recording created | `provisional` | Explicit v2 envelope; no default validation |
| `provisional` | clean capture sealed | `validating` | Persist valid lease before validation work |
| recovery journal | gap-free reconstruction | `needs_attention` | Cause `recovered_awaiting_validation` |
| recovery journal | reconstruction with gap | `needs_attention` | Cause `capture_gap_detected`; retain gap summary |
| `needs_attention` without capture gap | executable validation starts | `validating` | Preserve recovery/activity evidence; clear resolved attention causes; add lease |
| `validating` | integrity gate passes | `validated` | Proof and timestamp committed atomically |
| `validating` | integrity gate fails | `needs_attention` | Explicit causes and evidence; clear lease |
| `validating` | retry timeout/failure/interruption | `needs_attention` | Explicit retry cause; clear lease |
| `validating` | malformed/expired lease at startup | `needs_attention` | Persist `validation_retry_interrupted` or `validation_state_corrupt` |
| `needs_attention` with capture gap | retranscription passes surviving audio | `needs_attention` | Capture-gap cause survives |
| `needs_attention` with capture gap | restoration handler restores acknowledged evidence | `needs_attention` | Atomically add restoration proof, mark recovery gap false, and replace the gap cause with `recovered_awaiting_validation` |
| restored `needs_attention` | executable validation starts | `validating` | Preserve restoration proof and activity evidence; clear pending cause; add lease |
| `validated` | downstream generation fails | `validated` | Preserve proof; update downstream state only |

Superseded run protection remains mandatory. A stale run cannot commit any
transition after another run owns the current lease.

## Resolver

All consumers use one pure resolver:

```ts
type TranscriptTrustOperation = 'read_existing' | 'generate_new';

type TranscriptTrustAction =
  | 'recover_capture'
  | 'start_validation'
  | 'retry_validation'
  | 'resume_validation'
  | 'none';

type ResolvedTranscriptTrustState = {
  kind:
    | 'capture_recovery_required'
    | 'validation_state_corrupt'
    | 'validation_in_progress'
    | 'recovered_awaiting_validation'
    | 'capture_gap'
    | 'integrity_needs_attention'
    | 'validation_retry_failed'
    | 'validated'
    | 'legacy_complete'
    | 'legacy_needs_attention';
  copyKey: TranscriptTrustCopyKey;
  action: TranscriptTrustAction;
  permitsExistingRead: boolean;
  permitsDerivedGeneration: boolean;
};
```

The resolver receives persisted trust fields plus already-computed
content-free capability facts:

```ts
type TranscriptTrustCapabilities = {
  hasUsableMicArtifact: boolean;
  hasUsableSystemArtifact: boolean;
  hasUsableMixArtifact: boolean;
  hasSupportedActivityEvidence: boolean;
  validationMode:
    | 'full_mix'
    | 'recovered_channels'
    | 'unavailable';
  hasCaptureRecoveryHandler: boolean;
  canRestoreCaptureGap: boolean;
  hasExistingTranscript: boolean;
  hasExistingDerivedArtifacts: boolean;
};
```

It does not inspect the filesystem or invoke IPC. Artifact probing and evidence
parsing happen before resolution and use the same capability builder in UI and
retry services.

The shared action predicates are exact:

```ts
const canRunFullMixValidation =
  validationMode === 'full_mix' &&
  hasUsableMicArtifact &&
  hasUsableSystemArtifact &&
  hasUsableMixArtifact &&
  hasSupportedActivityEvidence;

const canRunRecoveredChannelValidation =
  validationMode === 'recovered_channels' &&
  hasSupportedActivityEvidence &&
  everySourceWithRecordedActivityHasAUsableArtifact &&
  atLeastOneUsableSourceArtifact;

const canRunValidation =
  canRunFullMixValidation || canRunRecoveredChannelValidation;

const canRunGapRestoration =
  hasCaptureRecoveryHandler && canRestoreCaptureGap;
```

`everySourceWithRecordedActivityHasAUsableArtifact` is computed from the parsed
activity windows: mic activity requires mic audio, system activity requires
system audio, and a source with zero recorded activity does not require an
artifact. `atLeastOneUsableSourceArtifact` prevents an empty meeting from
entering validation.

`full_mix` retains the current mic, system, and mix canonical policy.
`recovered_channels` is used only for capture-journal recovery and builds the
canonical candidate as the time-ordered union of independently transcribed mic
and system channels. It does not require a synthetic mix artifact. Source
labels are inherent (`Me` for mic, `Them` for system), duplicate lexical/time
overlap is collapsed, and source-specific coverage is evaluated against the
same activity evidence. This closes the current recovered-meeting path where
the mix artifact is absent.

The UI receives these facts through the meeting capability query. The retry
service recomputes them immediately before claiming a lease. A stale UI
capability can therefore hide an action or cause a safe service rejection, but
it cannot start an invalid operation.

## Precedence

Resolution uses this order:

1. `finalization_status === 'recovery_required'`.
2. Malformed or contradictory v2 envelope/projections.
3. `validating` with a valid live lease.
4. `validating` with a missing, malformed, or expired lease.
5. `needs_attention`, using cause precedence below.
6. `validated` with a valid proof.
7. Legacy compatibility policy.

Attention cause precedence:

1. `capture_gap_detected`
2. missing, corrupt, or unsupported deterministic/activity evidence
3. retry or transcript-owned processing failure
4. explicit local or remote unaccounted speech
5. other integrity causes
6. corrupt/unknown state

All causes remain available to content-free diagnostics, but only the
highest-precedence cause selects the user-facing headline and action.

## Copy and Action Matrix

| Resolved kind | User meaning | Allowed action |
| --- | --- | --- |
| capture recovery required | Recording was preserved but finalization recovery is required | `recover_capture` only when `hasCaptureRecoveryHandler`; otherwise `none` |
| validation state corrupt | Pluto cannot safely interpret validation state | `retry_validation` only when `canRunValidation`; otherwise `none` |
| validation in progress | Pluto is transcribing, reviewing evidence, or saving | `none` |
| recovered awaiting validation | Recording was recovered and awaits transcript validation | `start_validation` only when `canRunValidation` |
| capture gap | Pluto recovered available audio but knows acknowledged capture evidence is missing | `recover_capture` only when `canRunGapRestoration`; otherwise `none` |
| integrity needs attention: unaccounted speech | Validation explicitly found local or remote speech below coverage threshold | `retry_validation` only when `canRunValidation` |
| integrity needs attention: evidence/source/ambiguity | Validation could not establish a safe canonical transcript for the named content-free reason | `retry_validation` only when `canRunValidation` and the cause is retryable with the parsed evidence provenance |
| validation retry failed | Validation stopped by timeout, failure, or interruption | `retry_validation` only when `canRunValidation` |
| validated | Canonical integrity gate passed | `none` |
| legacy complete | Existing historical transcript/intelligence is readable but lacks v2 proof | `start_validation` only when `canRunValidation` |
| legacy needs attention | Historical state is incomplete or unknown | `start_validation` only when `canRunValidation` |

Only explicit `local_speech_unaccounted` or `remote_speech_unaccounted` causes
select copy claiming Pluto could not account for all captured speech.

Meeting View renders the resolved copy key and action. It does not parse JSON or
invent fallbacks. The retry service checks the same action-policy function
before invoking transcription, so rendering and execution cannot diverge.

## Legacy Compatibility

Rows without `schemaVersion` are legacy.

### Existing reads

- Legacy `validated` rows or null-status rows with an existing transcript may
  display that transcript.
- Existing derived artifacts may display unchanged.
- The UI labels this state through `legacy_complete`; it does not claim the v2
  canonical gate passed.

### New work

Legacy state never authorizes new analysis, regeneration, knowledge extraction,
value-signal generation, or other downstream output. Those entry points resolve
with operation `generate_new` and require v2 proof-backed `validated`.

To upgrade, Pluto runs explicit validation and atomically writes a v2 envelope
and all projections.

### Legacy edits

Unrelated user-field edits must remain possible. Title, notes, favorite, folder,
and similar updates preserve the existing trust-field bytes exactly. They do not
implicitly upgrade or revalidate the row.

Legacy `needs_attention`, malformed JSON, and incomplete state normalize
non-destructively for reads. Viewing a meeting never rewrites it.

The sole automatic trust repair is startup conversion of malformed or expired
`validating` state to an explicit v2 interrupted/corrupt attention state. This
prevents indefinite in-flight status and remains content-free.

## Persistence Entry Modes

Persistence exposes explicit modes rather than one permissive save contract:

1. `create_recording`: requires a valid v2 envelope and matching projections.
2. `transition_transcript_trust`: validates the expected current lease/version,
   legal transition, envelope, projections, and proof timestamp.
3. `update_transcript_owned_fields`: conditional update for the current
   validation run; validates all changed trust fields.
4. `update_user_fields`: may change only allowlisted non-trust fields and
   preserves trust bytes exactly, including legacy bytes.
5. `update_downstream_fields`: requires current proof-backed v2 validation but
   cannot change transcript trust fields.

The generic `SAVE_MEETING` IPC path must route to one of these modes or reject
the request. It cannot default missing trust state to `validated`.

## Downstream Processing State

Transcript validation and derived processing have separate persisted state.
Issue #556 adds nullable `meetings.downstream_processing_json` with this minimal
strict envelope:

```ts
type MeetingDownstreamProcessingV1 = {
  schemaVersion: 1;
  state: 'not_started' | 'processing' | 'complete' | 'failed';
  transcriptValidatedAt: string;
  runId?: string;
  stage?:
    | 'analysis'
    | 'value_signals'
    | 'knowledge_extraction'
    | 'final_save';
  failure?: 'generation_failed' | 'save_failed' | 'interrupted';
};
```

The parser requires exact keys, a supported schema version, a valid
`transcriptValidatedAt` equal to the current transcript proof timestamp, and
identifiers under the same 128-character rule as validation run IDs.

State invariants:

- `not_started` has no run, stage, or failure.
- `processing` requires run and stage and has no failure.
- `complete` has no run, stage, or failure.
- `failed` requires stage and failure and has no run.
- A transcript trust transition away from `validated` clears downstream state
  and its derived fields in the same transaction.
- A downstream transition never changes transcript trust fields.
- A failed downstream transition preserves the validated envelope, proof,
  transcript, and any prior coherent derived generation until a replacement
  commits successfully.

For legacy rows the field may be null. Existing derived fields remain readable
under the legacy policy, but new downstream generation first requires a v2
transcript proof and initializes this envelope.

## Producer Responsibilities

### Recording start and clean finalization

- Recording creation writes `provisional`.
- Sealing and validation transition through `validating` with a durable lease.
- A broad processing exception records the actual transcript-owned stage.
- Exceptions after proof-backed canonical save update downstream processing
  only.

### Capture-journal recovery

- Gap-free recovery writes `recovered_awaiting_validation`.
- Gap recovery writes `capture_gap_detected` with source scope and summary.
- Recovery metadata excludes paths from the v2 envelope.
- Existing local artifact paths remain in their dedicated database columns.

### Validation and retry

- Validation writes exact integrity causes and finite evidence.
- Retry begins only after shared action preconditions pass.
- Full-mix validation and recovered-channel validation use their explicitly
  selected canonical policies.
- Retry preserves capture-gap causes until restoration is proved.
- Timeout, failure, and interruption clear the lease and write explicit causes.
- Superseded runs return without mutation.

### Database/startup repair

- Startup detects expired, missing, or malformed validating leases.
- It persists an interrupted or corrupt attention envelope atomically.
- It never changes transcript content or downstream artifacts during repair.

### Downstream generation

- Generation writes `processing` with the current transcript proof timestamp
  before derived work begins.
- Successful atomic derived save writes `complete`.
- Failure or startup interruption writes `failed` without changing transcript
  state or proof.
- A stale downstream run cannot overwrite output for a newer transcript proof
  or downstream run.

## Downstream Gate

One gate replaces direct status comparisons:

```ts
canUseTranscriptTrustState(
  resolved: ResolvedTranscriptTrustState,
  operation: 'read_existing' | 'generate_new',
): boolean
```

`read_existing` permits v2 validated and grandfathered legacy-complete reads.
`generate_new` permits only proof-backed v2 validated state.

Analysis, regeneration, value signals, knowledge extraction, and any other
derived entry point must call this gate. Existing intelligence remains visible
when downstream generation later fails.

## Testing Strategy

### Pure state table

Table-driven tests cover:

- every legal v2 state;
- every cause and cause-precedence combination;
- malformed JSON and unsupported schema;
- contradictory status, lifecycle, and timestamp projections;
- invalid proof, lease, timestamp, number, digest, scope, and enum values;
- duplicate causes;
- artifact/evidence capability combinations;
- `read_existing` versus `generate_new`;
- action eligibility and copy keys.
- full-mix and recovered-channel predicates for every activity/source artifact
  combination.

### Producers

- gap-free and gap-bearing launch recovery;
- clean recording creation and validation;
- each transcript-owned failure stage;
- every downstream state transition, including post-validation failure
  preserving proof and prior coherent derived output;
- retry success, timeout, failure, interruption, and supersession;
- capture-gap preservation across successful retranscription of surviving
  audio;
- capture-gap clearance only after restored-evidence proof.

### Persistence

- rejection of cause-less attention, proof-less validation, lease-less
  validating, and projection conflict;
- removal of runtime implicit-validation defaults;
- exact preservation of legacy trust bytes during unrelated user edits;
- rejection of trust mutation through user/downstream modes;
- startup repair for malformed/expired validating leases;
- atomic proof/timestamp/projection commit.
- downstream mutations preserving trust bytes and rejecting stale proof/run
  ownership.

### UI and downstream

- Meeting View uses resolver output without raw JSON interpretation;
- every copy/action matrix row renders correctly;
- unaccounted-speech copy appears only for explicit local/remote causes;
- downstream generation blocks legacy, provisional, validating, attention, and
  corrupt state;
- existing legacy and validated derived artifacts remain readable.

### Regression and benchmark coverage

The committed synthetic recording-quality corpus distinguishes:

- gap-free recovered recording awaiting validation;
- recovered recording with known capture gap;
- confirmed local speech unaccounted;
- confirmed remote speech unaccounted;
- retry failure and malformed validation state.

Fixtures and reports contain no meeting content, names, paths, or transcript
excerpts.

## Verification

Implementation verification must include:

```bash
pnpm exec vitest run tests/unit/transcriptTrustState.test.ts
pnpm exec vitest run tests/unit/MeetingViewTranscriptIntegrity.test.tsx
pnpm exec vitest run tests/unit/captureJournalRecovery.test.ts
pnpm exec vitest run tests/unit/retryMeetingTranscriptValidation.test.ts
pnpm exec vitest run tests/unit/recordingFinalization.test.ts
pnpm exec vitest run tests/unit/transcriptSchema.test.ts
pnpm exec vitest run tests/unit/dbStopToValidatedLatency.test.ts
pnpm run recording-quality:pr
pnpm run changelog:check
pnpm run lint
pnpm run test -- --run
git diff --check
```

If Electron database tests encounter a `better-sqlite3` ABI mismatch, run
`pnpm run fix-sqlite-abi` and repeat the affected tests.

## Documentation and Traceability

- Record the authoritative v2 envelope and legacy generation boundary in
  `docs/decisions.md`.
- Add a uniquely named changelog fragment under `docs/changelog/entries/` with
  `Issue`, `PR`, `Changed`, `Why`, `Replaced`, and `Notes`.
- Link #556 from the implementation plan and PR.
- Keep the issue current if implementation changes cause taxonomy, transition
  precedence, legacy behavior, or action eligibility.

## Rollout

This is a local schema evolution without destructive database migration.

1. Ship strict readers, resolver, and persistence modes together.
2. New and rewritten trust state uses v2 immediately.
3. Legacy records normalize at read time and retain byte-for-byte state during
   unrelated edits.
4. Explicit validation upgrades a legacy meeting atomically.
5. No historical meeting is bulk-mutated.

The rollout is complete when new cause-less or proof-less states cannot persist,
existing meetings remain readable, and every trust message/action is produced
from the same validated contract.
