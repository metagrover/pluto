# End-to-End Meeting Transcript Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every saved meeting use the healthiest available wording while preserving raw evidence, suppressing loudspeaker echo, presenting readable sentences, carrying scoped vocabulary through restart, measuring speech-relative latency, and completing analysis through bounded progress-aware deadlines.

**Architecture:** Keep recovered-channel and live EOU candidates immutable. Add one pure saved-reading projection that performs utterance alignment, quality selection, echo cleanup, attribution, and sentence assembly, then route Meeting View and analysis through it. Persist only the candidate evidence, scoped vocabulary snapshot, content-free projection metadata, and responsiveness/progress evidence.

**Tech Stack:** TypeScript, React/Electron, Vitest, SQLite persisted-meeting replay, local Parakeet EOU/TDT, Ollama HTTP streaming.

---

### Task 1: Reconcile live and recovered wording per utterance

**Files:**
- Create: `src/utils/transcriptReadingProjection.ts`
- Modify: `src/utils/transcript.ts`
- Modify: `src/utils/transcriptSchema.ts`
- Test: `tests/unit/transcriptReadingProjection.test.ts`
- Test: `tests/unit/transcriptSpeakerPresentation.contract.test.ts`

- [ ] **Step 1: Write failing tests for healthier live wording, healthier recovered wording, uncovered intervals, deterministic ties, raw immutability, and display/analysis parity**

```ts
const result = buildTranscriptReadingProjection({
  recoveredSegments: fragmentedRecovered,
  liveSegments: coherentLive,
  mappingApplied: false,
});
expect(result.segments.map(({ text }) => text)).toEqual([
  'The coherent utterance remains intact.',
]);
expect(result.metadata.liveWordingSelections).toBe(1);
expect(fragmentedRecovered).toEqual(beforeRecovered);
expect(coherentLive).toEqual(beforeLive);
```

- [ ] **Step 2: Run the new tests and verify they fail because the reading projection does not exist**

Run: `pnpm exec vitest run tests/unit/transcriptReadingProjection.test.ts tests/unit/transcriptSpeakerPresentation.contract.test.ts`

- [ ] **Step 3: Implement utterance construction, temporal/token alignment, structural scoring, deterministic wording selection, and content-free metadata**

```ts
export type TranscriptReadingProjection = {
  segments: TranscriptReadingSegment[];
  metadata: {
    version: 'utterance_reconciliation_v1';
    recoveredWordingSelections: number;
    liveWordingSelections: number;
    unresolvedSelections: number;
  };
};
```

- [ ] **Step 4: Route `buildTranscriptSegmentsForPresentation` and `buildAnalysisTranscriptFromJson` through the same projection**

- [ ] **Step 5: Run the focused tests and commit the green slice**

Run: `pnpm exec vitest run tests/unit/transcriptReadingProjection.test.ts tests/unit/transcriptSpeakerPresentation.contract.test.ts tests/unit/MeetingViewTranscriptIntegrity.test.tsx`

Commit: `fix(transcript): reconcile live and final wording (#663)`

### Task 2: Suppress degraded phonetic mic echo without deleting double-talk

**Files:**
- Modify: `src/utils/speakerAttribution.ts`
- Modify: `src/utils/readableTranscript.ts`
- Modify: `docs/transcript-speaker-attribution.md`
- Test: `tests/unit/readableTranscript.test.ts`
- Test: `tests/unit/speakerAttribution.test.ts`

- [ ] **Step 1: Write failing synthetic tests for two-word phonetic echo, split System rows, exact time containment, genuine different-word interruption, and validated near-end override**

```ts
expect(
  buildReadableTranscriptSegments([
    remote(10, 14, 'Switch the task to Aster then.'),
    mic(11.5, 13.8, 'ask her then'),
  ]).segments,
).toEqual([expect.objectContaining({ speaker: 'Them' })]);
```

- [ ] **Step 2: Verify the phonetic fixtures fail while existing double-talk fixtures remain green**

Run: `pnpm exec vitest run tests/unit/readableTranscript.test.ts tests/unit/speakerAttribution.test.ts`

- [ ] **Step 3: Add a bounded normalized-token phonetic distance used only for at-most-four-word, 80-percent-contained mic fragments with no near-end evidence**

- [ ] **Step 4: Re-run the tests and document the exact thresholds**

- [ ] **Step 5: Commit the green slice**

Commit: `fix(transcript): remove degraded loudspeaker echo (#663)`

### Task 3: Assemble readable saved sentences without changing evidence

**Files:**
- Modify: `src/utils/transcriptReadingProjection.ts`
- Modify: `src/components/features/meetingTranscriptPresentation.ts`
- Test: `tests/unit/transcriptReadingProjection.test.ts`
- Test: `tests/unit/meetingTranscriptPresentation.test.ts`

- [ ] **Step 1: Write failing tests for fragment joining, 1.2-second pause boundaries, capitalization, terminal punctuation, contractions, acronyms, and neutral-turn grouping**

```ts
expect(projectReadingSegments([
  segment('Them', 0, 1, 'this is'),
  segment('Them', 1.1, 2, 'one thought'),
])).toEqual([expect.objectContaining({ text: 'This is one thought.' })]);
```

- [ ] **Step 2: Verify the tests fail on current plain-space concatenation**

- [ ] **Step 3: Implement deterministic presentation-only sentence assembly and keep canonical words/timestamps untouched**

- [ ] **Step 4: Verify Meeting View and analysis receive byte-identical projected sentence text**

- [ ] **Step 5: Commit the green slice**

Commit: `fix(transcript): assemble readable saved turns (#663)`

### Task 4: Persist scoped participant vocabulary across finalization and restart

**Files:**
- Modify: `src/utils/transcriptSchema.ts`
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/services/finalTranscription/runPersistedMeetingFinalTranscription.ts`
- Test: `tests/unit/transcriptSchema.test.ts`
- Test: `tests/unit/runPersistedMeetingFinalTranscription.test.ts`

- [ ] **Step 1: Write failing tests proving provisional payloads preserve sanitized vocabulary terms and restart finalization reuses them without `participants: []` lookup**

```ts
expect(input.vocabulary).toEqual(['Ada Lovelace', 'Project Atlas']);
expect(invoke).not.toHaveBeenCalledWith(
  'GET_TRANSCRIPTION_VOCABULARY',
  { participants: [] },
);
```

- [ ] **Step 2: Verify the restart test fails with an empty final vocabulary**

- [ ] **Step 3: Add a bounded `vocabularyTerms` snapshot to transcription metadata, populate it at stop, and prefer it during persisted finalization**

- [ ] **Step 4: Verify logs and content-free metadata expose counts only**

- [ ] **Step 5: Commit the green slice**

Commit: `fix(transcript): retain meeting vocabulary through restart (#663)`

### Task 5: Measure and reduce speech-relative first-text latency

**Files:**
- Modify: `src/utils/liveTranscriptResponsiveness.ts`
- Modify: `src/components/AudioManager.tsx`
- Test: `tests/unit/liveTranscriptResponsiveness.test.ts`
- Test: `tests/unit/liveTranscriptResponsivenessWiring.test.ts`
- Test: `tests/unit/liveTranscriptResponsivenessAudioManager.test.ts`

- [ ] **Step 1: Write failing tests for first detected speech, opening silence, speech-relative latency, missing speech evidence, and monotonic ordering**

```ts
accumulator.start(100);
accumulator.detectSpeech(5_000);
accumulator.publish(6_200, 1);
expect(accumulator.stop(7_000)).toMatchObject({
  firstTextLatencyMs: 6_100,
  firstSpeechToTextLatencyMs: 1_200,
});
```

- [ ] **Step 2: Verify the tests fail because speech detection is not wired to responsiveness**

- [ ] **Step 3: Extend the content-free summary schema compatibly and call `detectSpeech` from the debounced capture-activity transition**

- [ ] **Step 4: Verify tentative EOU text remains the first accepted publication and no durable journal receipt enters the live path**

- [ ] **Step 5: Commit the green slice**

Commit: `fix(transcript): measure speech-relative live latency (#663)`

### Task 6: Make foreground analysis streaming, progress-aware, and recoverable

**Files:**
- Modify: `electron/llm/unifiedProvider.ts`
- Modify: `src/services/processValidatedMeetingDownstream.ts`
- Modify: `src/services/downstreamStageDeadline.ts`
- Test: `tests/unit/unifiedProviderOllamaTimeout.test.ts`
- Test: `tests/unit/processValidatedMeetingDownstream.test.ts`
- Test: `tests/unit/downstreamStageDeadline.test.ts`

- [ ] **Step 1: Write failing tests that reproduce the five-minute topic-segmentation abort, prove first-chunk progress starts the active deadline, enforce a 30-second idle-stream timeout, and classify capacity wait separately**

```ts
const deadline = createProgressAwareStageDeadline({
  capacityTimeoutMs: 300_000,
  idleTimeoutMs: 30_000,
  activeTimeoutMs: 900_000,
});
deadline.markFirstChunk();
deadline.markProgress();
expect(deadline.state()).toBe('analysis');
```

- [ ] **Step 2: Verify the tests fail against the one-shot request timeout**

- [ ] **Step 3: Stream all analysis-class Ollama requests, reset idle progress on each response chunk, and calculate active deadlines from output budgets**

- [ ] **Step 4: Persist `waiting_for_model` and `analysis` transitions, cancel and settle timed-out requests, and map retryable capacity/idle failures without starting duplicate attempts**

- [ ] **Step 5: Re-run downstream and provider tests and commit the green slice**

Commit: `fix(analysis): use progress-aware local generation deadlines (#647 #663)`

### Task 7: Persisted replay and end-to-end acceptance

**Files:**
- Modify: `docs/transcript-speaker-attribution.md`
- Modify: `docs/decisions.md`
- Modify: `docs/changelog/entries/2026-08-25-664-trustworthy-recording-loop.md`
- Test: `tests/manual/parakeetApplicationWorkflow.test.ts`

- [ ] **Step 1: Run the latest private meeting through the new reading projection and compare content-free metrics with the prior 671-to-582 projection**

Run: `pnpm exec vitest run tests/manual/parakeetApplicationWorkflow.test.ts`

- [ ] **Step 2: Run focused transcript, latency, vocabulary, and analysis suites**

Run: `pnpm exec vitest run tests/unit/transcriptReadingProjection.test.ts tests/unit/readableTranscript.test.ts tests/unit/transcriptSpeakerPresentation.contract.test.ts tests/unit/transcriptSchema.test.ts tests/unit/runPersistedMeetingFinalTranscription.test.ts tests/unit/liveTranscriptResponsiveness.test.ts tests/unit/liveTranscriptResponsivenessWiring.test.ts tests/unit/processValidatedMeetingDownstream.test.ts`

- [ ] **Step 3: Run repository verification**

Run: `pnpm test`

Run: `pnpm exec tsc --noEmit`

Run: `pnpm exec biome check <changed-files>`

Run: `pnpm run changelog:check`

Run: `pnpm run build`

- [ ] **Step 4: Restore Electron SQLite ABI, open the latest meeting, and verify the actual saved transcript and analysis-retry path**

Run: `pnpm run fix-sqlite-abi`

- [ ] **Step 5: Commit documentation, post content-free evidence to #663, and leave unrelated work untouched**

Commit: `docs(transcript): record end-to-end quality acceptance (#663)`
