# Recording Transcript Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every completed recording pass mandatory full-session transcript validation, warn when live local transcription falls behind, and prevent unvalidated meeting data from feeding Pluto's downstream intelligence.

**Architecture:** Keep live chunks provisional and move trust decisions into focused pure utilities. Finalization always transcribes the preserved mic and mixed/system sources, reconciles them with channel-activity evidence, validates coverage, and persists either `validated` or `needs_attention` with content-free diagnostics. Raw channel paths remain local and retryable; analysis and entity extraction run only after validation.

**Tech Stack:** React 19, TypeScript, Electron IPC, better-sqlite3, Vitest, existing Whisper transcription backends, existing speaker-attribution utilities.

---

## Privacy Guardrail

All tests, fixtures, commit messages, issue comments, PR text, and changelog text must remain synthetic. Do not use local meeting titles, participant names, transcript excerpts, timestamps, audio paths, or business content. Do not copy files from `~/Library/Application Support/pluto` into the worktree.

## File Map

- Create `src/utils/transcriptIntegrity.ts`: pure live-coverage, canonical reconciliation, and final validation decisions.
- Create `tests/unit/transcriptIntegrity.test.ts`: synthetic regression coverage for sparse live local text, mic-only recovery, pass-through, and integrity failures.
- Create `src/services/recordingTranscriptValidation.ts`: renderer-side orchestration for full-session transcription with injected IPC calls and bounded retries.
- Create `tests/unit/recordingTranscriptValidation.test.ts`: orchestration tests with fake transcription functions; no audio or real transcript data.
- Modify `src/utils/transcriptSchema.ts`: persist lifecycle and content-free integrity evidence in the transcript envelope.
- Modify `tests/unit/transcriptSchema.test.ts`: schema compatibility and metadata tests.
- Modify `electron/db.ts`: persist transcript state plus local raw channel paths and diagnostics.
- Modify `electron/meetingInsertSql.ts`: add matching insert columns/placeholders.
- Modify `tests/unit/meetingInsertSql.test.ts`: assert new columns and placeholder parity.
- Modify `src/types.ts`: expose transcript lifecycle fields to renderer views.
- Modify `src/components/AudioManager.tsx`: collect live coverage evidence, run mandatory validation, save `needs_attention` safely, and gate downstream processing.
- Modify `src/components/features/recordingWorkspaceModel.ts`: model live transcript lag separately from capture failure.
- Modify `src/components/features/RecordingCaptureBar.tsx`: render the provisional/lagging state.
- Modify `src/components/features/ZenMode.tsx`: pass live integrity state into the workspace model.
- Modify `src/App.tsx`: hold live transcript integrity state and wire retry callbacks.
- Modify `src/components/features/MeetingView.tsx`: show validation state and retry action.
- Create `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`: render validation and retry behavior with a synthetic meeting.
- Modify `tests/unit/recordingWorkspaceModel.test.ts`: live warning behavior.
- Modify `tests/unit/RecordingWorkspaceComponents.test.tsx`: accessible warning/status rendering.
- Modify `src/utils/recordingFinalization.ts`: preserve source artifacts on validation failure and clean only superseded files after success.
- Modify `tests/unit/recordingFinalization.test.ts`: artifact-retention rules.
- Create `docs/changelog/entries/2026-07-14-recording-transcript-integrity.md`: sanitized shipped behavior.

### Task 1: Define transcript integrity decisions

**Files:**
- Create: `src/utils/transcriptIntegrity.ts`
- Create: `tests/unit/transcriptIntegrity.test.ts`

- [ ] **Step 1: Write failing live-coverage and final-validation tests**

Create synthetic helpers and tests:

```ts
import { describe, expect, it } from 'vitest';
import {
  evaluateLiveTranscriptCoverage,
  reconcileCanonicalTranscript,
  validateTranscriptIntegrity,
} from '../../src/utils/transcriptIntegrity';

const segment = (
  speaker: 'Me' | 'Them' | 'Unknown',
  startTime: number,
  endTime: number,
  text: string,
) => ({ id: `${speaker}-${startTime}`, speaker, startTime, endTime, text });

describe('transcriptIntegrity', () => {
  it('marks live local transcription as lagging when mic activity is unexplained', () => {
    expect(
      evaluateLiveTranscriptCoverage({
        micActivitySeconds: 18,
        localTranscriptSeconds: 0.4,
        conversionFailed: false,
        priorRetries: 0,
      }),
    ).toEqual({
      state: 'lagging',
      shouldRetry: true,
      reason: 'local_transcript_coverage_low',
    });
  });

  it('does not treat two trivial acknowledgements as complete local coverage', () => {
    const result = validateTranscriptIntegrity({
      recordingDurationSeconds: 1_500,
      micAudioDurationSeconds: 1_500,
      systemAudioDurationSeconds: 1_500,
      micActivitySeconds: 140,
      systemActivitySeconds: 900,
      localTranscriptCoveredSeconds: 1,
      remoteTranscriptCoveredSeconds: 850,
      unresolvedAmbiguousSeconds: 0,
      requiredSourcesSucceeded: true,
    });
    expect(result.status).toBe('needs_attention');
    expect(result.reasons).toContain('local_speech_unaccounted');
  });

  it('preserves mic-only canonical speech missing from provisional chunks', () => {
    const result = reconcileCanonicalTranscript({
      mixedSegments: [segment('Unknown', 10, 16, 'Synthetic local proposal')],
      micSegments: [segment('Me', 10, 16, 'Synthetic local proposal')],
      systemSegments: [],
      provisionalSegments: [],
      activityWindows: [{ speaker: 'Me', startTime: 10, endTime: 16 }],
    });
    expect(result.segments).toEqual([
      expect.objectContaining({ speaker: 'Me', text: 'Synthetic local proposal' }),
    ]);
  });

  it('collapses synthetic remote pass-through instead of duplicating Me', () => {
    const result = reconcileCanonicalTranscript({
      mixedSegments: [segment('Unknown', 20, 25, 'Synthetic remote update')],
      micSegments: [segment('Me', 20.1, 25.1, 'Synthetic remote update')],
      systemSegments: [segment('Them', 20, 25, 'Synthetic remote update')],
      provisionalSegments: [],
      activityWindows: [{ speaker: 'Them', startTime: 20, endTime: 25 }],
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].speaker).toBe('Them');
    expect(result.evidence.collapsedPassThroughSeconds).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run:

```bash
pnpm exec vitest run tests/unit/transcriptIntegrity.test.ts
```

Expected: FAIL because `src/utils/transcriptIntegrity.ts` does not exist.

- [ ] **Step 3: Implement focused types and decision functions**

Create the module with exported content-free evidence:

```ts
import {
  type AttributionSegment,
  type SpeakerActivityWindow,
  resolveCrossChannelDuplicates,
} from './speakerAttribution';

export type TranscriptLifecycleStatus =
  | 'provisional'
  | 'validating'
  | 'validated'
  | 'needs_attention';

export type TranscriptIntegrityReason =
  | 'local_transcript_coverage_low'
  | 'local_speech_unaccounted'
  | 'remote_speech_unaccounted'
  | 'required_source_failed'
  | 'channel_duration_mismatch'
  | 'ambiguous_pass_through';

export type TranscriptIntegrityEvidence = {
  micActivitySeconds: number;
  systemActivitySeconds: number;
  localTranscriptCoveredSeconds: number;
  remoteTranscriptCoveredSeconds: number;
  unexplainedMicSeconds: number;
  unexplainedSystemSeconds: number;
  collapsedPassThroughSeconds: number;
  unresolvedAmbiguousSeconds: number;
};

const ratio = (covered: number, active: number) =>
  active <= 0 ? 1 : Math.max(0, covered) / active;

export const evaluateLiveTranscriptCoverage = (input: {
  micActivitySeconds: number;
  localTranscriptSeconds: number;
  conversionFailed: boolean;
  priorRetries: number;
}) => {
  const lowCoverage =
    input.micActivitySeconds >= 3 &&
    ratio(input.localTranscriptSeconds, input.micActivitySeconds) < 0.35;
  if (!input.conversionFailed && !lowCoverage) {
    return { state: 'healthy' as const, shouldRetry: false, reason: null };
  }
  return {
    state: 'lagging' as const,
    shouldRetry: input.priorRetries < 1,
    reason: input.conversionFailed
      ? ('required_source_failed' as const)
      : ('local_transcript_coverage_low' as const),
  };
};

const overlap = (left: AttributionSegment, right: AttributionSegment) =>
  Math.max(
    0,
    Math.min(left.endTime, right.endTime) -
      Math.max(left.startTime, right.startTime),
  );

const activityOverlap = (
  segment: AttributionSegment,
  speaker: 'Me' | 'Them',
  windows: SpeakerActivityWindow[],
) =>
  windows
    .filter((window) => window.speaker === speaker)
    .reduce(
      (total, window) =>
        total +
        Math.max(
          0,
          Math.min(segment.endTime, window.endTime) -
            Math.max(segment.startTime, window.startTime),
        ),
      0,
    );

export const reconcileCanonicalTranscript = <T extends AttributionSegment>(
  input: {
    mixedSegments: T[];
    micSegments: T[];
    systemSegments: T[];
    provisionalSegments: T[];
    activityWindows: SpeakerActivityWindow[];
  },
) => {
  const attributed = input.mixedSegments.map((canonical) => {
    const micEvidence = Math.max(
      activityOverlap(canonical, 'Me', input.activityWindows),
      ...input.micSegments.map((candidate) => overlap(canonical, candidate)),
    );
    const systemEvidence = Math.max(
      activityOverlap(canonical, 'Them', input.activityWindows),
      ...input.systemSegments.map((candidate) => overlap(canonical, candidate)),
    );
    return {
      ...canonical,
      speaker: systemEvidence > micEvidence ? 'Them' : 'Me',
    } as T;
  });
  const canonicalWithMicRecovery = [
    ...attributed,
    ...input.micSegments.filter(
      (mic) => !attributed.some((candidate) => overlap(mic, candidate) >= 0.25),
    ),
  ].sort((left, right) => left.startTime - right.startTime);
  const deduped = resolveCrossChannelDuplicates(canonicalWithMicRecovery);
  const collapsedPassThroughSeconds = input.micSegments.reduce(
    (total, mic) =>
      total +
      Math.max(
        0,
        ...input.systemSegments.map((system) => overlap(mic, system)),
      ),
    0,
  );
  return {
    segments: deduped.segments as T[],
    evidence: {
      collapsedPassThroughSeconds,
      unresolvedAmbiguousSeconds: 0,
    },
  };
};

export const validateTranscriptIntegrity = (input: {
  recordingDurationSeconds: number;
  micAudioDurationSeconds: number;
  systemAudioDurationSeconds: number;
  micActivitySeconds: number;
  systemActivitySeconds: number;
  localTranscriptCoveredSeconds: number;
  remoteTranscriptCoveredSeconds: number;
  unresolvedAmbiguousSeconds: number;
  requiredSourcesSucceeded: boolean;
}) => {
  const reasons: TranscriptIntegrityReason[] = [];
  const durationTolerance = Math.max(3, input.recordingDurationSeconds * 0.03);
  if (!input.requiredSourcesSucceeded) reasons.push('required_source_failed');
  if (
    Math.abs(input.micAudioDurationSeconds - input.recordingDurationSeconds) >
      durationTolerance ||
    Math.abs(input.systemAudioDurationSeconds - input.recordingDurationSeconds) >
      durationTolerance
  ) {
    reasons.push('channel_duration_mismatch');
  }
  if (
    input.micActivitySeconds >= 3 &&
    ratio(input.localTranscriptCoveredSeconds, input.micActivitySeconds) < 0.65
  ) {
    reasons.push('local_speech_unaccounted');
  }
  if (
    input.systemActivitySeconds >= 3 &&
    ratio(input.remoteTranscriptCoveredSeconds, input.systemActivitySeconds) < 0.65
  ) {
    reasons.push('remote_speech_unaccounted');
  }
  if (input.unresolvedAmbiguousSeconds > 3) {
    reasons.push('ambiguous_pass_through');
  }
  return {
    status: reasons.length === 0 ? ('validated' as const) : ('needs_attention' as const),
    reasons,
  };
};
```

During implementation, keep this module pure. If existing attribution utilities require a small signature adjustment, cover that adjustment in `speakerAttribution.test.ts` before changing it.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm exec vitest run tests/unit/transcriptIntegrity.test.ts tests/unit/speakerAttribution.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the integrity primitives**

```bash
git add src/utils/transcriptIntegrity.ts tests/unit/transcriptIntegrity.test.ts src/utils/speakerAttribution.ts tests/unit/speakerAttribution.test.ts
git commit -m "feat: define transcript integrity gate"
```

### Task 2: Persist lifecycle and content-free evidence

**Files:**
- Modify: `src/utils/transcriptSchema.ts`
- Modify: `tests/unit/transcriptSchema.test.ts`
- Modify: `src/types.ts`
- Modify: `electron/db.ts`
- Modify: `electron/meetingInsertSql.ts`
- Modify: `tests/unit/meetingInsertSql.test.ts`

- [ ] **Step 1: Write failing schema and insert tests**

Add to `transcriptSchema.test.ts`:

```ts
it('stores validation lifecycle and content-free integrity evidence', () => {
  const payload = buildTranscriptJsonPayload([], {
    canonicalSource: 'mix',
    postHydrationBleedPass: false,
    lifecycleStatus: 'needs_attention',
    integrity: {
      micActivitySeconds: 40,
      systemActivitySeconds: 90,
      localTranscriptCoveredSeconds: 2,
      remoteTranscriptCoveredSeconds: 86,
      unexplainedMicSeconds: 38,
      unexplainedSystemSeconds: 4,
      collapsedPassThroughSeconds: 6,
      unresolvedAmbiguousSeconds: 0,
      reasons: ['local_speech_unaccounted'],
    },
  });
  expect(payload.lifecycleStatus).toBe('needs_attention');
  expect(payload.integrity?.reasons).toEqual(['local_speech_unaccounted']);
  expect(JSON.stringify(payload.integrity)).not.toContain('text');
});
```

Extend `meetingInsertSql.test.ts`:

```ts
expect(columns).toContain('transcript_status');
expect(columns).toContain('transcript_integrity_json');
expect(columns).toContain('system_audio_path');
expect(columns).toContain('mixed_audio_path');
```

- [ ] **Step 2: Run tests and verify failures**

```bash
pnpm exec vitest run tests/unit/transcriptSchema.test.ts tests/unit/meetingInsertSql.test.ts
```

Expected: FAIL because lifecycle options and persistence columns are absent.

- [ ] **Step 3: Extend the transcript envelope**

In `transcriptSchema.ts`, bump the pipeline version and import the shared types:

```ts
import type {
  TranscriptIntegrityEvidence,
  TranscriptIntegrityReason,
  TranscriptLifecycleStatus,
} from './transcriptIntegrity';

export const TRANSCRIPT_PIPELINE_VERSION = '2.0.0';

export type StoredTranscriptIntegrity = TranscriptIntegrityEvidence & {
  reasons: TranscriptIntegrityReason[];
};
```

Add these optional fields to `StoredTranscriptV2` and the builder options/result:

```ts
lifecycleStatus?: TranscriptLifecycleStatus;
integrity?: StoredTranscriptIntegrity;
```

Legacy transcript arrays and v2 envelopes without these fields must continue parsing unchanged.

- [ ] **Step 4: Add meeting persistence fields and migration**

Add to both `Meeting` and `PersistedMeeting`:

```ts
transcript_status?: TranscriptLifecycleStatus | null;
transcript_integrity_json?: string | null;
system_audio_path?: string | null;
mixed_audio_path?: string | null;
transcript_validated_at?: string | null;
```

Add the five columns to the table declaration and additive migration in `electron/db.ts`. Use `TEXT` for status, JSON, paths, and timestamp. Add matching columns before `created_at` in `MEETING_INSERT_SQL`, matching `stmt.run(...)` arguments in exactly the same order.

The defaults are:

```ts
meeting.transcript_status || 'validated'
meeting.transcript_integrity_json || null
meeting.system_audio_path || null
meeting.mixed_audio_path || null
meeting.transcript_validated_at || null
```

The `validated` default preserves existing meetings and manual saves.

- [ ] **Step 5: Run persistence tests and type checking**

```bash
pnpm exec vitest run tests/unit/transcriptSchema.test.ts tests/unit/meetingInsertSql.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit persistence**

```bash
git add src/utils/transcriptSchema.ts tests/unit/transcriptSchema.test.ts src/types.ts electron/db.ts electron/meetingInsertSql.ts tests/unit/meetingInsertSql.test.ts
git commit -m "feat: persist transcript validation state"
```

### Task 3: Orchestrate mandatory full-session validation

**Files:**
- Create: `src/services/recordingTranscriptValidation.ts`
- Create: `tests/unit/recordingTranscriptValidation.test.ts`
- Modify: `src/utils/transcriptIntegrity.ts`
- Modify: `tests/unit/transcriptIntegrity.test.ts`

- [ ] **Step 1: Write failing orchestration tests with injected transcription**

Create a fake transcription function and assert all required sources run regardless of provisional health:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runRecordingTranscriptValidation } from '../../src/services/recordingTranscriptValidation';

describe('runRecordingTranscriptValidation', () => {
  it('always transcribes mic, mix, and system sources', async () => {
    const transcribe = vi.fn(async (path: string) => ({
      segments: [
        { start: 0, end: 4, text: path.includes('system') ? 'Remote synthetic' : 'Local synthetic' },
      ],
      meta: { elapsedMs: 10 },
    }));
    const result = await runRecordingTranscriptValidation({
      meetingId: 'synthetic-meeting',
      recordingDurationSeconds: 60,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '/synthetic/mix.wav',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [],
      activityWindows: [
        { speaker: 'Me', startTime: 0, endTime: 4 },
        { speaker: 'Them', startTime: 5, endTime: 9 },
      ],
      transcribe,
      probeDuration: async () => 60,
    });
    expect(transcribe).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('validated');
  });

  it('returns needs_attention and preserves reason codes when one source fails', async () => {
    const transcribe = vi.fn(async (path: string) => {
      if (path.includes('system')) throw new Error('synthetic failure');
      return { segments: [], meta: { elapsedMs: 10 } };
    });
    const result = await runRecordingTranscriptValidation({
      meetingId: 'synthetic-meeting',
      recordingDurationSeconds: 60,
      micAudioPath: '/synthetic/mic.wav',
      mixAudioPath: '/synthetic/mix.wav',
      systemAudioPath: '/synthetic/system.wav',
      provisionalSegments: [],
      activityWindows: [],
      transcribe,
      probeDuration: async () => 60,
    });
    expect(result.status).toBe('needs_attention');
    expect(result.reasons).toContain('required_source_failed');
  });
});
```

- [ ] **Step 2: Run the test and verify missing service failure**

```bash
pnpm exec vitest run tests/unit/recordingTranscriptValidation.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement injected orchestration with bounded retry**

The service must not import React. Define injected boundaries:

```ts
type RawWhisperSegment = {
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
};

type Transcribe = (
  audioPath: string,
  options: { meetingId: string; canonicalSource: 'mic' | 'mix' | 'system' },
) => Promise<{ segments?: RawWhisperSegment[]; meta?: Record<string, unknown> }>;
```

Implement `transcribeWithRetry` with two total attempts and no transcript logging. Convert raw segments to attribution segments, run `reconcileCanonicalTranscript`, measure coverage against activity windows, probe all three durations, and call `validateTranscriptIntegrity`. Return:

```ts
{
  status,
  reasons,
  segments,
  evidence,
  attempts: { mic: number; mix: number; system: number },
  transcriptionMeta: { mic?: object; mix?: object; system?: object },
}
```

Do not include source paths or transcript text in `evidence` or thrown diagnostic errors.

- [ ] **Step 4: Run orchestration and integrity tests**

```bash
pnpm exec vitest run tests/unit/recordingTranscriptValidation.test.ts tests/unit/transcriptIntegrity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the validation service**

```bash
git add src/services/recordingTranscriptValidation.ts tests/unit/recordingTranscriptValidation.test.ts src/utils/transcriptIntegrity.ts tests/unit/transcriptIntegrity.test.ts
git commit -m "feat: require full-session transcript validation"
```

### Task 4: Add live transcript integrity monitoring

**Files:**
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/components/features/recordingWorkspaceModel.ts`
- Modify: `src/components/features/RecordingCaptureBar.tsx`
- Modify: `src/components/features/ZenMode.tsx`
- Modify: `src/App.tsx`
- Modify: `tests/unit/recordingWorkspaceModel.test.ts`
- Modify: `tests/unit/RecordingWorkspaceComponents.test.tsx`

- [ ] **Step 1: Write failing model and component tests**

Extend the model input with `liveTranscriptIntegrity: 'healthy' | 'lagging'`. Add:

```ts
it('distinguishes transcript lag from microphone capture failure', () => {
  const model = buildRecordingWorkspaceModel({
    startedAtMs: 1_000,
    nowMs: 11_000,
    isProcessing: false,
    microphone: 'healthy',
    systemAudio: 'healthy',
    liveTranscriptIntegrity: 'lagging',
    segments: [],
    interimText: '',
  });
  expect(model.needsAttention).toBe(true);
  expect(model.statusMessage).toBe(
    'Your audio is recording, but live transcription is falling behind',
  );
});
```

Add `liveTranscriptIntegrity="lagging"` to a capture-bar render test and assert the warning text plus `aria-live="assertive"`.

- [ ] **Step 2: Run focused UI tests and verify failures**

```bash
pnpm exec vitest run tests/unit/recordingWorkspaceModel.test.ts tests/unit/RecordingWorkspaceComponents.test.tsx
```

Expected: FAIL because live integrity props are missing.

- [ ] **Step 3: Wire the live integrity state through the UI**

Add:

```ts
export type LiveTranscriptIntegrity = 'healthy' | 'lagging';
```

to `recordingWorkspaceModel.ts`. Prefer capture failures over lag warnings, then use the exact warning string from the test. In `RecordingCaptureBar`, add a `liveTranscriptIntegrity` prop and set the status message container to `aria-live={liveTranscriptIntegrity === 'lagging' ? 'assertive' : 'polite'}`.

In `App.tsx`, initialize state to `healthy`, reset it on recording start, pass it to `ZenMode`, and accept `onLiveTranscriptIntegrityChange` from `AudioManager`.

- [ ] **Step 4: Trigger live coverage checks after each mic chunk**

In `AudioManagerProps`, add:

```ts
onLiveTranscriptIntegrityChange?: (
  state: LiveTranscriptIntegrity,
) => void;
```

In the mic chunk transcription path, calculate:

```ts
const micActivitySeconds = getSpeakerActivityCoverage(
  chunkStartSec,
  chunkEndSec,
  'Me',
);
const localTranscriptSeconds = micSegments.reduce(
  (total, segment) =>
    total + Math.max(0, segment.endTime - segment.startTime),
  0,
);
const liveDecision = evaluateLiveTranscriptCoverage({
  micActivitySeconds,
  localTranscriptSeconds,
  conversionFailed,
  priorRetries: retryCount,
});
onLiveTranscriptIntegrityChange?.(liveDecision.state);
```

If `shouldRetry` is true, enqueue exactly one retry using the already retained chunk blob. Merge successful retry segments by timestamp and ID; do not recursively retry. Reset the state to `healthy` only after a later chunk has adequate local coverage or the retry succeeds.

- [ ] **Step 5: Run UI and integrity tests**

```bash
pnpm exec vitest run tests/unit/recordingWorkspaceModel.test.ts tests/unit/RecordingWorkspaceComponents.test.tsx tests/unit/transcriptIntegrity.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit live monitoring**

```bash
git add src/components/AudioManager.tsx src/components/features/recordingWorkspaceModel.ts src/components/features/RecordingCaptureBar.tsx src/components/features/ZenMode.tsx src/App.tsx tests/unit/recordingWorkspaceModel.test.ts tests/unit/RecordingWorkspaceComponents.test.tsx
git commit -m "feat: surface live transcript integrity lag"
```

### Task 5: Replace heuristic finalization with mandatory validation

**Files:**
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/utils/recordingFinalization.ts`
- Modify: `tests/unit/recordingFinalization.test.ts`
- Modify: `src/utils/sessionTranscriptionFallback.ts`
- Modify: `tests/unit/sessionTranscriptionFallback.test.ts`

- [ ] **Step 1: Write failing artifact-retention tests**

Add to `recordingFinalization.test.ts`:

```ts
it('preserves all canonical source artifacts when validation needs attention', () => {
  expect(
    resolveFinalizationCleanupPaths({
      validationStatus: 'needs_attention',
      primaryAudioPath: '/synthetic/mic.wav',
      systemAudioPath: '/synthetic/system.wav',
      rebuiltSystemAudioPath: '',
      mixedAudioPath: '/synthetic/mix.wav',
    }),
  ).toEqual([]);
});

it('never schedules canonical raw sources for cleanup after an exception', () => {
  expect(
    collectDisposableRecordingArtifactPaths({
      primaryAudioPath: '/synthetic/mic.wav',
      systemAudioPath: '/synthetic/system.wav',
      mixedAudioPath: '/synthetic/mix.wav',
      rebuiltSystemAudioPath: '',
    }),
  ).toEqual([]);
});
```

- [ ] **Step 2: Run finalization tests and verify failures**

```bash
pnpm exec vitest run tests/unit/recordingFinalization.test.ts
```

Expected: FAIL because validation-aware cleanup does not exist.

- [ ] **Step 3: Preserve canonical sources and remove destructive error cleanup**

Add `validationStatus` to cleanup input. Return no cleanup paths for `needs_attention`; for `validated`, delete only superseded reconstructed intermediates, never `primaryAudioPath`, the selected `systemAudioPath`, or `mixedAudioPath`.

Replace the `AudioManager` catch block that calls `collectRecordingArtifactPaths(...)` with a content-free error save when paths exist. The error save must use:

```ts
transcript_status: 'needs_attention',
transcript_integrity_json: JSON.stringify({
  reasons: ['required_source_failed'],
}),
audio_path: primaryAudioPath || null,
system_audio_path: rebuiltSystemAudioPath || systemAudioPath || null,
mixed_audio_path: mixedAudioPath || null,
```

Never delete canonical audio after a validation or analysis failure.

- [ ] **Step 4: Call mandatory validation unconditionally**

In `stopSession`, after mic/system/mix files are saved, call `runRecordingTranscriptValidation` every time. Inject:

```ts
transcribe: (audioPath, options) =>
  window.ipcRenderer.invoke(
    'WHISPER_TRANSCRIBE',
    audioPath,
    buildTranscriptionOptions(options),
  ),
probeDuration: (audioPath) =>
  window.ipcRenderer.invoke('AUDIO_PROBE_DURATION', audioPath),
```

Add an `AUDIO_PROBE_DURATION` IPC handler in `electron/main.ts` using ffprobe through the existing fluent-ffmpeg dependency. It returns a number or `null` and logs no path.

Set `pipelineMode` to `canonical_session_v2` without an environment flag. Keep `getSessionFallbackDecision` only as provisional diagnostics and rename its stored meaning to `provisionalRecoveryReasons`; it must not control full-session execution.

Use `validationResult.segments` as `newTranscription`. Store lifecycle and evidence in both the transcript envelope and meeting columns. Persist all three local audio paths.

- [ ] **Step 5: Save `needs_attention` before downstream work**

When validation returns `needs_attention`:

1. Save the meeting with the provisional candidate transcript.
2. Set `enhanced_notes`, `analysis_json`, and `value_signals_json` to `null`.
3. Set `transcript_validated_at` to `null`.
4. Call `onSessionComplete(meetingId)` so the recoverable meeting is visible.
5. Return before title generation from transcript, analysis, or entity extraction. Preserve a user-entered title; otherwise use `Meeting`.

When validation returns `validated`, proceed with the canonical segments and set `transcript_validated_at` to a new ISO timestamp.

- [ ] **Step 6: Run finalization, fallback, service, and schema tests**

```bash
pnpm exec vitest run tests/unit/recordingFinalization.test.ts tests/unit/sessionTranscriptionFallback.test.ts tests/unit/recordingTranscriptValidation.test.ts tests/unit/transcriptSchema.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit mandatory finalization**

```bash
git add src/components/AudioManager.tsx src/utils/recordingFinalization.ts tests/unit/recordingFinalization.test.ts src/utils/sessionTranscriptionFallback.ts tests/unit/sessionTranscriptionFallback.test.ts electron/main.ts
git commit -m "fix: validate every completed recording"
```

### Task 6: Gate downstream intelligence and add retry

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/services/recordingTranscriptValidation.ts`
- Create: `src/services/retryMeetingTranscriptValidation.ts`
- Create: `tests/unit/retryMeetingTranscriptValidation.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing retry and downstream-gating tests**

Test the service with fake IPC methods:

```ts
it('does not generate analysis while validation needs attention', async () => {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'GET_MEETING') return syntheticNeedsAttentionMeeting;
    if (channel === 'WHISPER_TRANSCRIBE') return { segments: [] };
    if (channel === 'AUDIO_PROBE_DURATION') return 60;
    if (channel === 'SAVE_MEETING') return true;
    throw new Error(`Unexpected channel: ${channel}`);
  });
  await retryMeetingTranscriptValidation('synthetic-id', invoke);
  expect(invoke).not.toHaveBeenCalledWith('GENERATE_ANALYSIS_V2', expect.anything());
  expect(invoke).not.toHaveBeenCalledWith('EXTRACT_AND_PROCESS_ENTITIES', expect.anything());
});

it('generates downstream artifacts once after validation succeeds', async () => {
  const invoke = createSuccessfulSyntheticInvoke();
  await retryMeetingTranscriptValidation('synthetic-id', invoke);
  expect(channelCalls(invoke, 'GENERATE_ANALYSIS_V2')).toHaveLength(1);
  expect(channelCalls(invoke, 'EXTRACT_AND_PROCESS_ENTITIES')).toHaveLength(1);
});
```

The fake meeting uses `/synthetic/*.wav` strings only.

- [ ] **Step 2: Run the test and verify missing service failure**

```bash
pnpm exec vitest run tests/unit/retryMeetingTranscriptValidation.test.ts
```

Expected: FAIL because the retry service does not exist.

- [ ] **Step 3: Implement idempotent retry orchestration**

`retryMeetingTranscriptValidation(meetingId, invoke)` must:

1. Load the meeting.
2. Return immediately when `transcript_status === 'validated'` and `analysis_json` is present.
3. Require all persisted local audio paths; otherwise save `needs_attention` with `required_source_failed`.
4. Mark the meeting `validating`.
5. Run the shared mandatory validation service.
6. Save `needs_attention` and stop when the gate fails.
7. On success, generate title only if the title is still the generic default, generate analysis, save the canonical transcript and analysis atomically, then invoke entity extraction once.

Use a `validation_run_id` inside `transcript_integrity_json` and compare it before downstream save so overlapping retries cannot both publish derived data.

- [ ] **Step 4: Add retry UI and validation state**

In `MeetingView`, render a compact status panel before enhanced notes when status is `validating` or `needs_attention`. Use content-free messages:

```tsx
<section aria-live="polite" className="transcript-integrity-panel">
  <strong>
    {status === 'validating'
      ? 'Validating transcript'
      : 'Transcript needs attention'}
  </strong>
  <p>
    {status === 'validating'
      ? 'Pluto is checking the complete recording before creating intelligence.'
      : 'The recording is safe, but Pluto could not account for all captured speech.'}
  </p>
  {status === 'needs_attention' && (
    <button type="button" onClick={onRetryTranscriptValidation}>
      Retry transcript validation
    </button>
  )}
</section>
```

Wire `onRetryTranscriptValidation` from `App.tsx`, call the service, refresh meetings, and keep the selected meeting open. Disable the button during an active retry.

- [ ] **Step 5: Add a component test for the retry panel**

Create `tests/unit/MeetingViewTranscriptIntegrity.test.tsx` with a synthetic meeting whose title is `Synthetic meeting`, whose transcript contains `Synthetic local statement`, and whose `transcript_status` is `needs_attention`. Render `MeetingView` with no-op callbacks and assert `Transcript needs attention`, the content-free explanation, and `Retry transcript validation`.

- [ ] **Step 6: Run retry, Meeting View, and type tests**

```bash
pnpm exec vitest run tests/unit/retryMeetingTranscriptValidation.test.ts tests/unit/MeetingViewTranscriptIntegrity.test.tsx tests/unit/meetingViewActionCards.test.tsx
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit retry and downstream gating**

```bash
git add src/App.tsx src/components/features/MeetingView.tsx src/services/recordingTranscriptValidation.ts src/services/retryMeetingTranscriptValidation.ts tests/unit/retryMeetingTranscriptValidation.test.ts tests/unit/MeetingViewTranscriptIntegrity.test.tsx src/types.ts
git commit -m "feat: retry incomplete meeting transcripts"
```

### Task 7: Add the synthetic end-to-end regression and ship documentation

**Files:**
- Create: `tests/unit/recordingTranscriptIntegrityRegression.test.ts`
- Create: `docs/changelog/entries/2026-07-14-recording-transcript-integrity.md`
- Modify: `docs/superpowers/specs/2026-07-14-recording-transcript-integrity-design.md` only if implementation changes an approved contract.

- [ ] **Step 1: Write the synthetic regression**

Model a 25-minute session without real audio or meeting data:

```ts
it('recovers substantive synthetic local speech despite healthy remote chunks', async () => {
  const provisional = [
    segment('Me', 7, 7.2, 'Acknowledged.'),
    segment('Me', 25, 25.2, 'Confirmed.'),
    ...syntheticRemoteSegments(120),
  ];
  const localCanonical = [
    segment('Me', 420, 450, 'Synthetic proposal with multiple supporting points.'),
    segment('Me', 680, 720, 'Synthetic follow-up question and recommendation.'),
    segment('Me', 1_020, 1_060, 'Synthetic implementation constraints.'),
  ];
  const result = await runSyntheticValidation({
    durationSeconds: 1_500,
    provisional,
    localCanonical,
    remoteCanonical: syntheticRemoteSegments(120),
  });
  expect(result.status).toBe('validated');
  expect(result.segments.filter((item) => item.speaker === 'Me')).toEqual(
    expect.arrayContaining(
      localCanonical.map((item) => expect.objectContaining({ text: item.text })),
    ),
  );
});
```

The test must fail if mandatory mic transcription is skipped, if provisional chunks can veto canonical speech, or if pass-through cleanup removes mic-only segments.

- [ ] **Step 2: Run the regression and complete unit suite**

```bash
pnpm exec vitest run tests/unit/recordingTranscriptIntegrityRegression.test.ts
pnpm run test
```

Expected: PASS.

- [ ] **Step 3: Add the sanitized changelog fragment**

Create:

```markdown
---
issue: 428
category: Fixed
---

Completed recordings now receive full-session transcript validation before Pluto creates summaries or knowledge. Live transcription warns when local speech coverage falls behind, and preserved local audio can be retried instead of silently producing incomplete meeting intelligence.
```

- [ ] **Step 4: Run repository verification**

```bash
pnpm run changelog:check
pnpm run lint
pnpm exec tsc --noEmit
pnpm run test
pnpm run build
pnpm audit --audit-level high
```

Expected: all checks pass. If the audit endpoint itself returns an HTTP retirement or availability error, record the exact infrastructure failure; do not report it as a vulnerability finding and do not bypass an actual high-severity advisory.

- [ ] **Step 5: Run a privacy scan before commit**

```bash
rg -n "Application Support/pluto|session-mic_[0-9]|session-system_[0-9]" \
  src tests docs/superpowers/specs/2026-07-14-recording-transcript-integrity-design.md \
  docs/superpowers/plans/2026-07-14-recording-transcript-integrity.md \
  docs/changelog/entries/2026-07-14-recording-transcript-integrity.md
```

Expected: no output. Also inspect `git diff --cached` and verify every example is synthetic.

- [ ] **Step 6: Commit regression and documentation**

```bash
git add tests/unit/recordingTranscriptIntegrityRegression.test.ts docs/changelog/entries/2026-07-14-recording-transcript-integrity.md docs/superpowers/specs/2026-07-14-recording-transcript-integrity-design.md
git commit -m "test: guard recording transcript completeness"
```

## Final Verification Checklist

- [ ] Every completed recording invokes mic, mix, and system full-session processing.
- [ ] Sparse local chunk output cannot suppress canonical mic recovery.
- [ ] Remote pass-through is not duplicated as local speech.
- [ ] Live lag is distinct from microphone capture failure.
- [ ] `needs_attention` meetings retain all canonical local audio paths.
- [ ] Analysis and entity extraction cannot run before validation.
- [ ] Retry is idempotent and publishes downstream intelligence once.
- [ ] Existing meetings without lifecycle fields remain readable as validated legacy data.
- [ ] No sensitive meeting data appears in source control or GitHub-facing text.
- [ ] Issue #428, the spec, plan, changelog, commits, and eventual PR remain sanitized.
