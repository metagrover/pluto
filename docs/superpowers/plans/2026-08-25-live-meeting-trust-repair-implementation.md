# Live Meeting Trust Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live transcript presentation trustworthy, release capture for back-to-back meetings immediately after a durable sealed handoff, and make foreground analysis preempt and visibly outrank resumable background knowledge work.

**Architecture:** `AudioManager` owns one capture lifecycle and publishes it to every recording entry point. Live EOU evidence remains raw internally while a pure reconciler produces neutral/punctuated presentation rows. The local-model gate owns cancellation and settlement; downstream and knowledge jobs persist versioned progress/checkpoints and notify the renderer after state changes.

**Tech Stack:** React 18, TypeScript, Electron IPC, Node HTTP, Vitest, Biome, SQLite through existing DB helpers.

---

### Task 1: Capture lifecycle authority and recording-rail cleanup (#664)

**Files:**
- Create: `src/services/captureLifecycle.ts`
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/utils/captureSessionGuard.ts`
- Modify: `src/components/features/RecordingMeetingRail.tsx`
- Modify: `src/index.css`
- Test: `tests/unit/captureLifecycle.test.ts`
- Test: `tests/unit/captureSessionGuard.test.ts`
- Test: `tests/unit/AppRecordingNavigation.dom.test.tsx`
- Test: `tests/unit/RecordingWorkspaceComponents.test.tsx`

- [ ] **Step 1: Write failing lifecycle and DOM tests**

```ts
expect(resolveCaptureAction({ state: 'idle' })).toEqual({
  label: 'New meeting',
  enabled: true,
  command: 'start',
});
expect(resolveCaptureAction({ state: 'sealing' })).toMatchObject({
  label: 'Finishing meeting',
  enabled: false,
});
expect(container.textContent).toContain('New meeting');
expect(container.textContent).not.toMatch(/Capture diagnostics|Meeting details/);
expect(container.querySelector('#recording-participant')).not.toBeNull();
```

- [ ] **Step 2: Run focused tests and verify the expected failures**

Run: `pnpm exec vitest run tests/unit/captureLifecycle.test.ts tests/unit/captureSessionGuard.test.ts tests/unit/AppRecordingNavigation.dom.test.tsx tests/unit/RecordingWorkspaceComponents.test.tsx`

Expected: failures because `processing` still owns the sidebar/start guard and both disclosure rows still render.

- [ ] **Step 3: Add the authoritative lifecycle contract**

```ts
export type CaptureLifecycleState = 'idle' | 'starting' | 'recording' | 'sealing';
export type CaptureStartResult =
  | { admitted: true; meetingId: string }
  | { admitted: false; state: CaptureLifecycleState; reason: string };

export const resolveCaptureAction = (snapshot: CaptureLifecycleSnapshot) =>
  snapshot.state === 'idle'
    ? { label: 'New meeting', enabled: true, command: 'start' as const }
    : snapshot.state === 'recording'
      ? { label: 'Return to recording', enabled: true, command: 'return' as const }
      : {
          label: snapshot.state === 'starting' ? 'Starting meeting' : 'Finishing meeting',
          enabled: false,
          command: 'wait' as const,
        };
```

`AudioManager.startSession()` checks the lifecycle ref, returns `CaptureStartResult`, and is the only start-admission implementation. `App`, Sidebar, Command-N, and unload protection consume the emitted snapshot.

- [ ] **Step 4: Persist the sealed handoff before returning to idle**

After capture-journal seal, snapshot raw EOU segments, vocabulary, activity evidence, responsiveness, and journal generation. Persist a provisional meeting immediately with the sealed integrity proof and no fabricated audio paths. Call `onSessionComplete`, publish `idle`, and release the meeting-owned refs. Continue audio materialization against local snapshots; update the same meeting with materialized paths without clearing a newer session’s refs.

- [ ] **Step 5: Replace the two disclosure rows with the compact participant section**

Render one always-visible `section.rail-participants` with the existing label, input, chips, removal, Enter-to-add, and accessible controls. Remove `.rail-meta` and `.rail-diagnostics` rules and use a single quiet top margin without a new card or separator.

- [ ] **Step 6: Run focused tests and commit**

Run the focused command from Step 2, then `pnpm exec biome lint src/services/captureLifecycle.ts src/components/AudioManager.tsx src/App.tsx src/components/layout/Sidebar.tsx src/utils/captureSessionGuard.ts src/components/features/RecordingMeetingRail.tsx tests/unit/captureLifecycle.test.ts tests/unit/captureSessionGuard.test.ts tests/unit/AppRecordingNavigation.dom.test.tsx tests/unit/RecordingWorkspaceComponents.test.tsx` and `git diff --check`.

Commit: `feat: release capture for back-to-back meetings (#664)`

### Task 2: Raw-preserving live transcript reconciler and punctuation (#663)

**Files:**
- Create: `src/services/liveTranscription/liveTranscriptReconciler.ts`
- Modify: `src/services/liveTranscription/eouTranscriptProjection.ts`
- Modify: `src/services/liveTranscription/eouRendererSession.ts`
- Modify: `src/utils/captureActivitySession.ts`
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/components/features/recordingWorkspaceModel.ts`
- Test: `tests/unit/liveTranscriptReconciler.test.ts`
- Test: `tests/unit/eouTranscriptProjection.test.ts`
- Test: `tests/unit/eouRendererSession.test.ts`
- Test: `tests/unit/captureActivitySession.test.ts`

- [ ] **Step 1: Write failing reconciler fixtures**

Cover mic-exclusive speech (`Me`), insufficient/missing activity (`Speaker`), System speech (`Them`), overlapping lexical duplicates (System retained), contractions, repeated words, three-word containment, delayed evidence within five seconds, expiry after five seconds, and committed-only punctuation.

```ts
expect(reconcileLiveTranscript({ segments: [mic], activityWindows: [], nowSeconds: 4 }))
  .toMatchObject([{ speaker: 'Speaker', text: 'we should ship.' }]);
expect(result.rawSegments[0].text).toBe('we should ship');
```

- [ ] **Step 2: Run tests and verify failures**

Run: `pnpm exec vitest run tests/unit/liveTranscriptReconciler.test.ts tests/unit/eouTranscriptProjection.test.ts tests/unit/eouRendererSession.test.ts tests/unit/captureActivitySession.test.ts`

- [ ] **Step 3: Implement the pure reconciler**

Normalize with Unicode NFKC, lowercase, retained internal apostrophes, removed other punctuation, and a versioned stop-word set. Clip activity windows to token-derived segment intervals. Require mic coverage `>= 0.60`, System coverage `<= 0.15`, and no matching System hypothesis. Track accepted labels so only `Speaker` may refine during the five-second horizon.

- [ ] **Step 4: Keep raw and presentation payloads separate**

`eouTranscriptProjection` returns `{ presentationSegments, rawSegments }`. Punctuation and suppression affect only presentation. `AudioManager` publishes presentation rows to `LiveTranscript`, but provisional/canonical handoff uses raw text, timestamps, and source-derived evidence.

- [ ] **Step 5: Refresh attribution as activity evidence grows**

`captureActivitySession.windows(nowSeconds)` includes a clipped copy of the active window. `eouRendererSession.refreshEvidence(nowSeconds)` re-runs reconciliation and only republishes when the visible projection changes.

- [ ] **Step 6: Run focused tests and commit**

Run the focused test command, targeted Biome lint, and `git diff --check`.

Commit: `feat: present neutral readable live transcripts (#663)`

### Task 3: Correlated speech-relative latency evidence (#663)

**Files:**
- Modify: `src/utils/liveTranscriptResponsiveness.ts`
- Modify: `src/services/liveTranscription/eouRendererSession.ts`
- Modify: `src/components/AudioManager.tsx`
- Test: `tests/unit/liveTranscriptResponsiveness.test.ts`
- Test: `tests/unit/liveTranscriptResponsivenessWiring.test.ts`
- Test: `tests/unit/audioManagerParakeetEouWiring.test.ts`

- [ ] **Step 1: Write failing schema-v2 timing tests**

```ts
runtime.acceptStart('correlation-1');
runtime.acceptSpeechDetected();
runtime.acceptFirstPcm();
runtime.acceptNativeUpdate();
runtime.acceptProjection();
runtime.publishAcceptedSegments([{ text: 'hello' }], publish);
expect(runtime.freezeBeforeFinalization()).toMatchObject({
  schemaVersion: 2,
  speechToFirstTextLatencyMs: 800,
  boundaries: { firstPcmMs: 100, nativeUpdateMs: 500, projectionMs: 700 },
});
```

- [ ] **Step 2: Verify RED, then implement schema v2 with v1 parsing compatibility**

Use one injected renderer monotonic clock. Record correlation ID, detector algorithm/config hash, availability reasons, first PCM append, first native EOU update observation, first accepted projection, and first renderer publication. Never store text or cross-process wall-clock subtraction.

- [ ] **Step 3: Wire activity and EOU boundaries, verify, and commit**

Run: `pnpm exec vitest run tests/unit/liveTranscriptResponsiveness.test.ts tests/unit/liveTranscriptResponsivenessWiring.test.ts tests/unit/audioManagerParakeetEouWiring.test.ts`

Commit: `feat: measure speech-relative live latency (#663)`

### Task 4: Cooperative local-model gate and cancellable streaming transport (#647)

**Files:**
- Create: `electron/taskPreemption.ts`
- Modify: `electron/serializedTaskGate.ts`
- Modify: `electron/llm/provider.ts`
- Modify: `electron/llm/unifiedProvider.ts`
- Modify: `electron/llm/ollamaHttpTransport.ts`
- Test: `tests/unit/serializedTaskGate.test.ts`
- Test: `tests/unit/ollamaHttpTransport.test.ts`
- Test: `tests/unit/unifiedProvider.test.ts`

- [ ] **Step 1: Write failing gate and transport tests**

Test foreground cancellation of active background work, settlement before slot reuse, queued cancellation removal, FIFO, stable-key sharing, request/response/socket destruction, first-chunk callback, first-chunk timeout (`local_model_busy`), idle timeout, and active deadline.

- [ ] **Step 2: Verify RED, then implement the gate API**

```ts
gate.run(
  { key, priority, taskClass: 'foreground', signal },
  async (gateSignal) => operation(gateSignal),
);
```

The gate aborts active background work with `ForegroundPreemptedError`, waits for its promise to settle, removes aborted queued work, and deduplicates only exact stable keys.

- [ ] **Step 3: Stream Ollama and separate deadlines**

Send `stream: true`, parse NDJSON chunks, call `onFirstChunk` once, reset the 30-second idle timer per chunk, and enforce capacity and active timers separately. Cancellation destroys the Node request, response, and socket. Stable keys include task, owner/request ID, input hash, and pass identity.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm exec vitest run tests/unit/serializedTaskGate.test.ts tests/unit/ollamaHttpTransport.test.ts tests/unit/unifiedProvider.test.ts`

Commit: `feat: preempt background Ollama work (#647)`

### Task 5: Durable knowledge checkpoints and resumable preemption (#647)

**Files:**
- Modify: `electron/knowledgeDocConfig.ts`
- Modify: `electron/knowledgeSynthesis.ts`
- Modify: `electron/knowledgeSynthesisPause.ts`
- Test: `tests/unit/knowledgeDocConfig.test.ts`
- Test: `tests/unit/knowledgeChunking.test.ts`
- Test: `tests/unit/knowledgeDocument.test.ts`

- [ ] **Step 1: Write failing checkpoint tests**

Verify `{schemaVersion,inputHash,completedChunks,nextChunkIndex,partialStructuredJson}` round-trips in config, is excluded from the next input hash, skips completed chunks for the same input, invalidates on input change, and bypasses split/retry plus terminal `failed` persistence on `foreground_preempted`.

- [ ] **Step 2: Verify RED, then persist checkpoints after each chunk**

Use deterministic chunk keys from input hash plus ordered meeting IDs. Save checkpoint and partial document in the same `upsertKnowledgeDoc` call. On completion, remove the checkpoint and stamp the synthesis input hash.

- [ ] **Step 3: Resume after foreground settlement**

Queued refreshes mark themselves pending on preemption. Immediate meeting refresh waits for pause release, rebuilds the request, and resumes from the durable checkpoint without redoing completed chunks.

- [ ] **Step 4: Run focused tests and commit**

Commit: `feat: resume preempted knowledge synthesis (#647)`

### Task 6: Persisted analysis progress, renderer invalidation, and truthful copy (#647)

**Files:**
- Modify: `src/services/downstreamProcessingLease.ts`
- Modify: `src/services/processValidatedMeetingDownstream.ts`
- Modify: `electron/db.ts`
- Modify: `electron/main.ts`
- Modify: `electron/llm/provider.ts`
- Modify: `electron/llm/unifiedProvider.ts`
- Modify: `src/components/features/downstreamProcessingPresentation.ts`
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/App.tsx`
- Test: `tests/unit/downstreamProcessingLease.test.ts`
- Test: `tests/unit/processValidatedMeetingDownstream.test.ts`
- Test: `tests/unit/downstreamProcessingPresentation.test.ts`
- Test: `tests/unit/MeetingViewProgressiveReveal.dom.test.tsx`

- [ ] **Step 1: Write failing progress-state tests**

Test `queued → waiting_for_model → analysis → complete`, pass counters, last-progress lease renewal, retryable `local_model_busy`, visible copy changes, invalidation refresh, bounded polling fallback, and reload presentation from persisted JSON.

- [ ] **Step 2: Verify RED, then add nested progress schema v1**

Persist owner meeting ID, attempt/run ID, state-entered time, completed/known passes, last-progress time, and typed failure. The downstream coordinator owns transitions; provider callbacks may only advance the current run through a DB compare-and-set helper.

- [ ] **Step 3: Deliver live progress**

`SAVE_MEETING`, claims, and provider progress updates emit `MEETING_PROCESSING_UPDATED` with meeting ID only. `App` refreshes on that event. `MeetingView` also polls every two seconds only while active and stops on terminal state, view change, or unmount.

- [ ] **Step 4: Reconcile deadlines and failure mapping**

Use five minutes for pre-first-chunk capacity, per-request active deadlines from output budget, 30-second idle stream timeout, and a 30-minute cumulative active workflow budget. Renew the one-hour downstream lease only on persisted progress. Map capacity expiry to `local_model_busy` without changing recording availability.

- [ ] **Step 5: Run focused tests and commit**

Commit: `feat: show truthful meeting analysis progress (#647)`

### Task 7: Full integration, durable records, and acceptance evidence

**Files:**
- Add: `docs/changelog/entries/2026-08-25-live-meeting-trust-repair.md`
- Modify: `docs/decisions.md`
- Modify tests only where integration fixtures need the new versioned contracts.

- [ ] **Step 1: Add the changelog fragment and durable decision**

Record that capture ownership ends at sealed durable handoff, raw transcript evidence is separate from live presentation, and foreground analysis cooperatively preempts resumable knowledge work.

- [ ] **Step 2: Run focused slice suites**

Run every focused command from Tasks 1-6.

- [ ] **Step 3: Run repository verification**

Run: `pnpm run test`, `pnpm run lint`, `pnpm run build`, `pnpm run changelog:check`, `pnpm run audit:high`, and `git diff --check`.

- [ ] **Step 4: Run Electron acceptance**

Start Pluto, record a meeting with opening silence and two-channel speech, add a participant, stop, confirm New meeting after sealed handoff, start a second capture while the first downstream lease is active, and verify progress plus persisted/reloaded artifacts. Preserve only content-free timing/state evidence.

- [ ] **Step 5: Commit integration evidence**

Commit: `docs: record live meeting trust repair`
