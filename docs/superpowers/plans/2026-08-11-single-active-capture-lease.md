# Single Active Capture Lease Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent renderer lifecycle resets or secondary renderers from creating overlapping recording sessions or taking ownership of native system audio.

**Architecture:** Add a small, pure lease registry in the Electron layer and make every capture start, stop, seal, native-audio start, and owner-destruction transition pass through it. Keep the renderer change narrow: recognize the stable conflict code as a hard start failure before microphone acquisition, and prevent active recording/processing pages from unloading. The lease remains runtime-only; interrupted journals continue to use Pluto's existing durable recovery path.

**Tech Stack:** Electron IPC and WebContents lifecycle events, React refs/effects, TypeScript, Vitest, existing capture-journal APIs.

---

### Task 1: Define the runtime lease state machine

**Files:**
- Create: `electron/captureSessionLease.ts`
- Create: `tests/unit/captureSessionLease.test.ts`

- [ ] **Step 1: Write failing lease behavior tests**

Cover these synthetic transitions with owner IDs `11` and `22` and meeting keys `meeting-alpha` and `meeting-beta`:

```ts
const registry = createCaptureSessionLeaseRegistry();
expect(registry.acquire('meeting-alpha', 11).status).toBe('acquired');
expect(registry.acquire('meeting-alpha', 11).status).toBe('already_owned');
expect(() => registry.acquire('meeting-beta', 11)).toThrow(
  CAPTURE_SESSION_ALREADY_ACTIVE,
);
expect(() => registry.acquire('meeting-alpha', 22)).toThrow(
  CAPTURE_SESSION_ALREADY_ACTIVE,
);
expect(registry.release('meeting-alpha', 22)).toBe(false);
expect(registry.release('meeting-alpha', 11)).toBe(true);
expect(registry.acquire('meeting-beta', 22).status).toBe('acquired');
expect(registry.releaseOwner(22)?.meetingId).toBe('meeting-beta');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/captureSessionLease.test.ts`

Expected: FAIL because `electron/captureSessionLease.ts` does not exist.

- [ ] **Step 3: Add the minimal registry**

Implement one in-memory active lease with:

```ts
export const CAPTURE_SESSION_ALREADY_ACTIVE =
  'capture_session_already_active';

export type CaptureSessionLease = {
  meetingId: string;
  ownerId: number;
  phase: 'recording' | 'stopped';
};

export const createCaptureSessionLeaseRegistry = () => {
  let active: CaptureSessionLease | null = null;
  return {
    acquire(meetingId: string, ownerId: number) {
      if (!active) {
        active = { meetingId, ownerId, phase: 'recording' };
        return { status: 'acquired' as const, lease: { ...active } };
      }
      if (
        active.meetingId === meetingId &&
        active.ownerId === ownerId &&
        active.phase === 'recording'
      ) {
        return { status: 'already_owned' as const, lease: { ...active } };
      }
      throw new Error(CAPTURE_SESSION_ALREADY_ACTIVE);
    },
    activeForOwner(ownerId: number) {
      return active?.ownerId === ownerId ? { ...active } : null;
    },
    recordingForOwner(ownerId: number) {
      return active?.ownerId === ownerId && active.phase === 'recording'
        ? { ...active }
        : null;
    },
    markStopped(meetingId: string, ownerId: number) {
      if (active?.meetingId !== meetingId || active.ownerId !== ownerId) {
        throw new Error('capture_session_not_owned');
      }
      active = { ...active, phase: 'stopped' };
      return { ...active };
    },
    release(meetingId: string, ownerId: number) {
      if (active?.meetingId !== meetingId || active.ownerId !== ownerId) {
        return false;
      }
      active = null;
      return true;
    },
    releaseOwner(ownerId: number) {
      if (active?.ownerId !== ownerId) return null;
      const released = { ...active };
      active = null;
      return released;
    },
  };
};
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run tests/unit/captureSessionLease.test.ts`

Expected: PASS.

### Task 2: Enforce ownership in Electron IPC and native audio

**Files:**
- Modify: `electron/main.ts`
- Create: `tests/unit/captureSessionOwnershipBoundary.test.ts`

- [ ] **Step 1: Write failing boundary tests**

Read `electron/main.ts` as source and assert that:

```ts
expect(main).toContain('createCaptureSessionLeaseRegistry()');
expect(journalStartHandler).toContain('captureSessionLease.acquire(');
expect(journalStartHandler).toContain('capture_session_already_active');
expect(journalStopHandler).toContain('captureSessionLease.markStopped(');
expect(journalStopHandler).not.toContain('captureSessionLease.release(');
expect(journalSealHandler).toContain('captureSessionLease.requireStoppedOwner(');
expect(journalSealHandler).toContain('captureSessionLease.release(');
expect(nativeStartHandler).toContain('recordingForOwner(');
expect(nativeStartHandler).not.toContain("win.webContents.send('NATIVE_AUDIO_CHUNK'");
expect(nativeStartHandler).toContain("captureOwner.send('NATIVE_AUDIO_CHUNK'");
expect(main).toContain("owner.once('destroyed'");
```

The source-boundary test complements the registry unit tests by proving the production IPC handlers actually use the state machine.

- [ ] **Step 2: Run the boundary test and verify RED**

Run: `pnpm exec vitest run tests/unit/captureSessionOwnershipBoundary.test.ts`

Expected: FAIL because Electron IPC does not yet use a capture lease.

- [ ] **Step 3: Acquire the lease before journal creation**

In `AUDIO_CAPTURE_JOURNAL_START`:

```ts
const normalizedMeetingId = String(meetingId || '');
const acquisition = captureSessionLease.acquire(
  normalizedMeetingId,
  event.sender.id,
);
try {
  const manifest = await createCaptureJournal(getMeetingArtifactsRootDir(), {
    meetingId: normalizedMeetingId,
    startedAtMs: typeof startedAtMs === 'number' ? startedAtMs : Date.now(),
    schemaVersion: 3,
    expectedSources,
    sourceAvailability,
  });
  watchCaptureOwner(event.sender);
  console.log(`[CaptureLease] ${acquisition.status}`);
  return manifest;
} catch (error) {
  if (acquisition.status === 'acquired') {
    captureSessionLease.release(normalizedMeetingId, event.sender.id);
  }
  throw error;
}
```

Log only the transition and reason. Do not log meeting IDs, owner IDs, paths, or content.

- [ ] **Step 4: Retain ownership through the stop/seal boundary**

Require the matching owner before mutating stop or seal state. After a successful `stopCaptureJournal`, transition the runtime lease from `recording` to `stopped` and keep it until seal completes. Release after a successful seal; if seal fails after the journal already stopped, release with the explicit `seal_failed_after_stop` reason so durable recovery remains available without blocking future recordings. A failed stop retains the recording lease.

- [ ] **Step 5: Bind native audio to the lease owner**

Require `NATIVE_AUDIO_START` to find the sender's active lease. Store the starting `WebContents` as the native owner and send chunks only through it:

```ts
const lease = captureSessionLease.recordingForOwner(event.sender.id);
if (!lease) throw new Error('capture_session_not_owned');
if (nativeAudioProcess) return nativeAudioOwner?.id === event.sender.id;
const spawnedProcess = spawn(execPath);
const captureOwner = event.sender;
nativeAudioProcess = spawnedProcess;
nativeAudioOwner = captureOwner;
spawnedProcess.stdout?.on('data', (chunk) => {
  if (
    nativeAudioProcess === spawnedProcess &&
    !captureOwner.isDestroyed()
  ) {
    captureOwner.send('NATIVE_AUDIO_CHUNK', chunk);
  }
});
```

Reject `NATIVE_AUDIO_STOP` from a non-owner. Clear the native owner on process close.

- [ ] **Step 6: Handle owner destruction**

Register one `destroyed` listener per lease owner. On destruction, stop the native process if that owner holds it, release the runtime lease with an `owner_destroyed` diagnostic, and leave the durable journal untouched for existing startup recovery.

- [ ] **Step 7: Run lease and boundary tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/captureSessionLease.test.ts tests/unit/captureSessionOwnershipBoundary.test.ts tests/unit/captureJournalSealBoundary.test.ts tests/unit/nativeAudioCapture.test.ts`

Expected: PASS.

### Task 3: Fail closed in the renderer and prevent active unloads

**Files:**
- Create: `src/utils/captureSessionGuard.ts`
- Modify: `src/components/AudioManager.tsx`
- Create: `tests/unit/captureSessionGuard.test.ts`
- Extend: `tests/unit/captureSessionOwnershipBoundary.test.ts`

- [ ] **Step 1: Write failing renderer-guard tests**

Test error normalization without depending on Electron's wrapper text:

```ts
expect(isCaptureSessionAlreadyActiveError(
  new Error('Error invoking remote method: capture_session_already_active'),
)).toBe(true);
expect(isCaptureSessionAlreadyActiveError(new Error('disk unavailable'))).toBe(false);
expect(shouldPreventCaptureUnload({ recording: true, processing: false })).toBe(true);
expect(shouldPreventCaptureUnload({ recording: false, processing: true })).toBe(true);
expect(shouldPreventCaptureUnload({ recording: false, processing: false })).toBe(false);
```

Extend the source-boundary test to prove conflict handling returns before `getUserMedia` and that `beforeunload` consults the recording and processing refs.

- [ ] **Step 2: Run the renderer tests and verify RED**

Run: `pnpm exec vitest run tests/unit/captureSessionGuard.test.ts tests/unit/captureSessionOwnershipBoundary.test.ts`

Expected: FAIL because the guard utility and renderer wiring do not exist.

- [ ] **Step 3: Add the pure renderer guards**

```ts
export const isCaptureSessionAlreadyActiveError = (error: unknown) =>
  String(error).includes('capture_session_already_active');

export const shouldPreventCaptureUnload = ({ recording, processing }: {
  recording: boolean;
  processing: boolean;
}) => recording || processing;
```

- [ ] **Step 4: Make a lease conflict a hard start rejection**

In `startSession`, recognize only the stable conflict code. Reset the unstarted session refs, abort live responsiveness start state, clear the provisional activity session, show a generic explanation, and `return` before `getUserMedia`. Preserve the existing durability-warning behavior for unrelated journal errors.

Move the user-visible recording-start publication until after the journal attempt so a rejected session is never briefly announced as recording.

- [ ] **Step 5: Prevent unload during recording or finalization**

Add one mount-scoped `beforeunload` listener:

```ts
const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!shouldPreventCaptureUnload({
    recording: isRecordingRef.current,
    processing: isProcessingRef.current,
  })) return;
  event.preventDefault();
  event.returnValue = '';
};
```

The handler must be removed on unmount. Keep Electron's default `will-prevent-unload` behavior so refresh/navigation stays cancelled while capture is active.

- [ ] **Step 6: Run renderer and boundary tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/captureSessionGuard.test.ts tests/unit/captureSessionOwnershipBoundary.test.ts`

Expected: PASS.

### Task 4: Record traceability and verify the finished branch

**Files:**
- Create: `docs/changelog/entries/2026-08-11-601-single-active-capture.md`
- Modify only if the implementation changes durable architecture policy: `docs/decisions.md`

- [ ] **Step 1: Add a privacy-safe changelog fragment**

Use Pluto's six-field format and link issue #601 and the eventual PR. Describe the synthetic lifecycle outcome only; include no private recording evidence, identities, transcript text, recording identifiers, timing/count data, or local paths.

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm exec vitest run tests/unit/captureSessionLease.test.ts tests/unit/captureSessionGuard.test.ts tests/unit/captureSessionOwnershipBoundary.test.ts tests/unit/captureJournalSealBoundary.test.ts tests/unit/nativeAudioCapture.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full branch verification**

Run:

```bash
pnpm run test
pnpm run lint
pnpm run changelog:check
pnpm run audit:high
pnpm exec vite build
```

Expected: all commands exit 0. If the aggregate `pnpm run build` is also run, report any pre-existing baseline TypeScript diagnostics separately and do not reinterpret them as changed-file failures.

- [ ] **Step 4: Review scope and privacy**

Run `git diff --check`, inspect every changed line, and search the branch for private names, meeting content, recording identifiers, private paths, and copied incident metrics. Confirm every changed line traces to #601.

- [ ] **Step 5: Commit and open the first PR**

Commit with issue-scoped messages, push `codex/601-single-capture-lease`, create a ready PR linked with `Closes #601`, update the changelog fragment with the PR URL, rerun final verification on final HEAD, and add one privacy-safe issue comment summarizing implementation and aggregate verification.
