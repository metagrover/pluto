# Recording Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** #357

**Goal:** Replace the note-dominant recording view with a compact command center that makes capture health obvious, exposes the live transcript, and keeps notes secondary.

**Architecture:** Keep recording and transcription ownership in `AudioManager`, but expose a small renderer-facing snapshot through callbacks. Derive display state in a pure `recordingWorkspaceModel.ts`; render focused capture-bar, transcript, and meeting-rail components through `ZenMode`. Do not alter transcription models, attribution, persistence, or finalization.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, Electron renderer IPC

---

## File map

- Create `src/components/features/recordingWorkspaceModel.ts`: state types and elapsed/health helpers.
- Create `src/components/features/RecordingCaptureBar.tsx`: status, title, input health, and finish action.
- Create `src/components/features/LiveTranscript.tsx`: grouped incremental transcript with live-edge recovery.
- Create `src/components/features/RecordingMeetingRail.tsx`: participants, notes, and collapsed diagnostics.
- Modify `src/components/AudioManager.tsx`: emit existing incremental transcript and input-health signals.
- Modify `src/App.tsx`: own the UI snapshot and pass it to `ZenMode`.
- Modify `src/components/features/ZenMode.tsx`: compose the workspace and remove decorative/emoji-only controls.
- Modify `src/index.css`: scoped density utilities and reduced-motion treatment.
- Create focused tests under `tests/unit/` for the model and each component.

### Task 1: Define the renderer-facing recording model

**Files:**
- Create: `src/components/features/recordingWorkspaceModel.ts`
- Create: `tests/unit/recordingWorkspaceModel.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildRecordingWorkspaceModel } from '../../src/components/features/recordingWorkspaceModel';

describe('buildRecordingWorkspaceModel', () => {
  it('keeps healthy capture calm while exposing transcript state', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000,
      nowMs: 62_000,
      isProcessing: false,
      microphone: 'healthy',
      systemAudio: 'healthy',
      segments: [{ id: '1', speaker: 'Me', text: 'Ship the review.', timestampMs: 12_000, confirmed: true }],
      interimText: 'Then notify',
    });
    expect(model.elapsedLabel).toBe('01:01');
    expect(model.status).toBe('recording');
    expect(model.needsAttention).toBe(false);
    expect(model.transcript).toHaveLength(1);
    expect(model.interimText).toBe('Then notify');
  });

  it('raises attention when either input reports a warning', () => {
    const model = buildRecordingWorkspaceModel({
      startedAtMs: 1_000, nowMs: 2_000, isProcessing: false,
      microphone: 'warning', systemAudio: 'healthy', segments: [], interimText: '',
    });
    expect(model.needsAttention).toBe(true);
    expect(model.statusMessage).toContain('Microphone');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `../../node_modules/.bin/vitest run tests/unit/recordingWorkspaceModel.test.ts --run`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal model**

```ts
export type CaptureHealth = 'healthy' | 'warning' | 'unavailable';
export type LiveTranscriptSegment = {
  id: string;
  speaker: 'Me' | 'Them' | 'Unknown';
  text: string;
  timestampMs: number;
  confirmed: boolean;
};

export type RecordingWorkspaceInput = {
  startedAtMs: number | null;
  nowMs: number;
  isProcessing: boolean;
  microphone: CaptureHealth;
  systemAudio: CaptureHealth;
  segments: LiveTranscriptSegment[];
  interimText: string;
};

const formatElapsed = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export const buildRecordingWorkspaceModel = (input: RecordingWorkspaceInput) => {
  const microphoneWarning = input.microphone !== 'healthy';
  const systemAudioWarning = input.systemAudio !== 'healthy';
  return {
    status: input.isProcessing ? ('processing' as const) : ('recording' as const),
    elapsedLabel: formatElapsed(input.startedAtMs ? input.nowMs - input.startedAtMs : 0),
    microphone: input.microphone,
    systemAudio: input.systemAudio,
    needsAttention: microphoneWarning || systemAudioWarning,
    statusMessage: microphoneWarning
      ? 'Microphone needs attention'
      : systemAudioWarning
        ? 'System audio needs attention'
        : 'Capture is healthy',
    transcript: input.segments.filter((segment) => segment.text.trim()),
    interimText: input.interimText.trim(),
  };
};
```

- [ ] **Step 4: Run the focused test**

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/features/recordingWorkspaceModel.ts tests/unit/recordingWorkspaceModel.test.ts
git commit -m "feat: define recording workspace view model"
```

### Task 2: Expose incremental transcript and capture health

**Files:**
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/App.tsx`
- Test: `tests/unit/recordingWorkspaceModel.test.ts`

- [ ] **Step 1: Add callback contracts to `AudioManager`**

```ts
onLiveTranscript?: (segments: LiveTranscriptSegment[], interimText: string) => void;
onCaptureHealthChange?: (health: {
  microphone: CaptureHealth;
  systemAudio: CaptureHealth;
}) => void;
```

- [ ] **Step 2: Emit signals only from existing pipeline points**

Emit input health from existing microphone/system-audio success and failure branches. Map already-validated chunk segments immediately after the current chunk merge. Do not invoke final analysis, persistence, diarization, or attribution a second time.

- [ ] **Step 3: Wire state through `App.tsx`**

```ts
const [liveTranscript, setLiveTranscript] = useState<LiveTranscriptSegment[]>([]);
const [interimTranscript, setInterimTranscript] = useState('');
const [captureHealth, setCaptureHealth] = useState({
  microphone: 'healthy' as CaptureHealth,
  systemAudio: 'healthy' as CaptureHealth,
});
```

Reset the snapshot at session start and final cleanup. Pass callbacks to `AudioManager` and values to `ZenMode`.

- [ ] **Step 4: Verify regression coverage**

```bash
../../node_modules/.bin/vitest run tests/unit/recordingFinalization.test.ts tests/unit/transcript.test.ts tests/unit/transcriptSchema.test.ts --run
```

Expected: all existing tests pass and the persisted transcript schema is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/AudioManager.tsx src/App.tsx tests/unit/recordingWorkspaceModel.test.ts
git commit -m "feat: expose live recording workspace signals"
```

### Task 3: Build the persistent capture bar

**Files:**
- Create: `src/components/features/RecordingCaptureBar.tsx`
- Create: `tests/unit/RecordingCaptureBar.test.tsx`

- [ ] **Step 1: Write server-rendered accessibility tests**

Assert one `header`, an `aria-live="polite"` status, explicit microphone/system-audio text, elapsed time, an editable title label, and a button named “Finish recording.” Add a warning case with actionable text that does not rely on color.

- [ ] **Step 2: Run the test and verify it fails**

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component**

Use Lucide icons, sentence-case labels, `focus-visible:ring-2`, stable status geometry, and a 44 px minimum finish button. Do not add pause because current behavior does not support it.

- [ ] **Step 4: Run tests and commit**

```bash
../../node_modules/.bin/vitest run tests/unit/RecordingCaptureBar.test.tsx --run
git add src/components/features/RecordingCaptureBar.tsx tests/unit/RecordingCaptureBar.test.tsx
git commit -m "feat: add accessible recording capture bar"
```

### Task 4: Build the transcript surface

**Files:**
- Create: `src/components/features/LiveTranscript.tsx`
- Create: `tests/unit/LiveTranscript.test.tsx`

- [ ] **Step 1: Write tests for empty, populated, interim, and scrolled states**

Verify speaker headings, `time` labels, interim text marked `aria-hidden="true"`, a quiet waiting state, and a “Return to live transcript” button when the user is not at the live edge.

- [ ] **Step 2: Implement grouped rendering**

Group adjacent same-speaker segments in a pure helper. Render one continuous surface with dividers, not cards. Auto-scroll only while at the live edge; manual scrolling must not be overridden.

- [ ] **Step 3: Implement reduced-motion-safe recovery**

Use instant scrolling for `prefers-reduced-motion` and smooth scrolling otherwise. Do not put transcript content in a live region.

- [ ] **Step 4: Run tests and commit**

```bash
../../node_modules/.bin/vitest run tests/unit/LiveTranscript.test.tsx --run
git add src/components/features/LiveTranscript.tsx tests/unit/LiveTranscript.test.tsx
git commit -m "feat: add live transcript workspace"
```

### Task 5: Build the collapsible meeting rail

**Files:**
- Create: `src/components/features/RecordingMeetingRail.tsx`
- Create: `tests/unit/RecordingMeetingRail.test.tsx`

- [ ] **Step 1: Write state tests**

Cover expanded/collapsed labels, participant-removal accessible names, notes input, diagnostics disclosure, and local preference key `pluto.recordingRailCollapsed`.

- [ ] **Step 2: Implement without speculative persistence**

Move the existing participant lookup and notes editor from `ZenMode` intact. Keep notes as the current persisted string. Do not add an action-item button until a real action persistence contract exists.

- [ ] **Step 3: Run tests and commit**

```bash
../../node_modules/.bin/vitest run tests/unit/RecordingMeetingRail.test.tsx --run
git add src/components/features/RecordingMeetingRail.tsx tests/unit/RecordingMeetingRail.test.tsx
git commit -m "feat: add recording meeting rail"
```

### Task 6: Compose, verify, and document the command center

**Files:**
- Modify: `src/components/features/ZenMode.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/decisions.md`

- [ ] **Step 1: Compose the workspace**

Use a `minmax(0,1fr) 300px` desktop grid and transcript-first single-column reflow for narrow windows. Remove emoji icons and the decorative visualizer from the primary hierarchy. Retain a small level indicator only when it conveys actual health.

- [ ] **Step 2: Add scoped density primitives**

Add `.workspace-surface`, `.workspace-row`, and reduced-motion rules using existing semantic color variables. Do not introduce a second token system or hardcoded light-only Stone colors.

- [ ] **Step 3: Run focused and broad verification**

```bash
../../node_modules/.bin/vitest run tests/unit/recordingWorkspaceModel.test.ts tests/unit/RecordingCaptureBar.test.tsx tests/unit/LiveTranscript.test.tsx tests/unit/RecordingMeetingRail.test.tsx tests/unit/recordingFinalization.test.ts --run
../../node_modules/.bin/tsc --noEmit --pretty false
../../node_modules/.bin/biome check src/App.tsx src/components/features/ZenMode.tsx src/components/features/RecordingCaptureBar.tsx src/components/features/LiveTranscript.tsx src/components/features/RecordingMeetingRail.tsx src/components/features/recordingWorkspaceModel.ts
```

Expected: focused tests and checks pass. Compare any repository-baseline type failure against `origin/master` and document it.

- [ ] **Step 4: Perform design QA**

Verify light/dark themes, narrow/wide Electron windows, keyboard-only finish and rail flows, long titles, long/no transcript, one failed input, processing, and reduced motion. Score the result with the six-dimension UX rubric; no dimension may ship below 7/10 and accessibility/usability must reach 8/10.

- [ ] **Step 5: Record the outcome and commit**

Update the changelog with the user outcome, record transcript-as-primary hierarchy in decisions, and comment verification evidence on #357.

```bash
git add src/App.tsx src/components/features/ZenMode.tsx src/index.css docs/CHANGELOG.md docs/decisions.md
git commit -m "feat: make recording a quiet command center"
```

