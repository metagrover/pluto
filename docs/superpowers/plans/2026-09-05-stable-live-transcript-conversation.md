# Stable Live Transcript Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live transcript readable during loudspeaker meetings by rendering append-only conversation history plus one bounded, revisable draft, while preserving raw dual-source evidence and final-transcript behavior.

**Architecture:** Keep native mic and System EOU output as immutable source evidence. Convert that evidence into reversible, time-bounded reading fragments, then feed a meeting-scoped stateful conversation projection that is the sole owner of visible ordering. Confirmed visible fragments append to history; tentative fragments occupy one draft at the live edge. A raw segment may yield several visible and suppressed fragments, but no presentation decision rewrites persisted transcript evidence.

**Tech Stack:** TypeScript, React 18, Electron, Vitest/happy-dom, Swift Parakeet EOU tests, TailwindCSS/Biome.

**Issue:** [#670 — Make dual-source live transcripts readable during loudspeaker meetings](https://github.com/metagrover/pluto/issues/670)

---

## Product and trust contract

- History is append-only within a recording session. A visible history turn never moves because a source changes from tentative to confirmed.
- At most one draft appears below history. While speech is active, it revises in place and shows at most the latest 24 visible words total, merged into one chronological reading region.
- The draft label is `Listening now` when speaker ownership is uncertain. It may show `You` or `Call` only when all visible draft fragments agree on one source.
- `Refining last words` appears beside the draft, not as a page-wide status that makes settled history look unstable.
- A confirmed fragment arriving behind the history frontier appends at the live edge with its original timestamp and an `Earlier speech` qualifier; it never inserts above existing DOM nodes.
- Source labels, raw alternate rows, match confidence, and suppression diagnostics are excluded from the normal reading surface. They remain available through existing raw evidence and content-free diagnostics.
- This plan changes live presentation only. It does not modify stored live candidates, final transcription, notes evidence, or canonical speaker identity.

## State model

```ts
export type LiveReadingFragment = {
  id: string;
  sourceSegmentId: string;
  source: 'mic' | 'system';
  text: string;
  timestampMs: number;
  endTimestampMs: number;
  confirmed: boolean;
  wordRange: { start: number; end: number };
  evidence: 'raw' | 'cross_channel_echo_retained';
};

export type LiveConversationTurn = {
  id: string;
  speaker: 'You' | 'Call';
  timestampMs: number;
  endTimestampMs: number;
  text: string;
  fragmentIds: string[];
  arrival: 'chronological' | 'late';
};

export type LiveConversationDraft = {
  id: 'live-draft';
  speaker: 'You' | 'Call' | 'Listening now';
  text: string;
  fragmentIds: string[];
} | null;

export type LiveConversationView = {
  history: LiveConversationTurn[];
  draft: LiveConversationDraft;
};
```

`LiveReadingFragment` is derived and disposable. `LiveTranscriptSegment` remains the raw renderer evidence type.

---

### Task 1: Freeze the Sep 5 failure shape as a non-sensitive regression

**Files:**
- Create: `tests/fixtures/liveTranscriptJumbledSources.ts`
- Modify: `tests/unit/LiveTranscript.dom.test.tsx`
- Modify: `tests/unit/eouTranscriptProjection.test.ts`

- [ ] **Step 1: Add a synthetic causal fixture matching the observed topology**

Build a fixture with a 43.5-second, 105-word mic buffer, three System turns, six disjoint echo spans, and short unmatched local replies. Use invented wording only. Export monotonic EOU revisions and acoustic evidence windows; do not copy production transcript text, meeting IDs, embeddings, audio paths, or person names.

- [ ] **Step 2: Write the failing end-to-end DOM regression**

Replay each fixture revision through `createEouTranscriptProjection`, reconciliation, and `LiveTranscript`. Assert after every render:

```ts
expect(committedNodeIds(next)).toEqual([
  ...committedNodeIds(previous),
  ...newCommittedNodeIds,
]);
expect(container.querySelectorAll('[data-live-draft]')).toHaveLength(1);
expect(duplicateVisiblePhrases(container)).toEqual([]);
```

Also assert that the six remote spans appear once, every local reply remains visible, and a committed row never moves ahead of an already rendered row.

- [ ] **Step 3: Replace the old ordering expectation with the desired behavior**

In `tests/unit/eouTranscriptProjection.test.ts`, replace `keeps an older tentative buffer at the live edge after committed history` with a test that requires raw source rows to remain timestamp ordered. The dedicated conversation projector, not the raw EOU projection, owns the live edge.

- [ ] **Step 4: Run the regressions and verify failure**

Run:

```bash
pnpm vitest run tests/unit/eouTranscriptProjection.test.ts tests/unit/LiveTranscript.dom.test.tsx
```

Expected: FAIL because confirmed-first sorting moves rows and `LiveTranscript` has no single draft/history contract.

- [ ] **Step 5: Commit the red tests**

```bash
git add tests/fixtures/liveTranscriptJumbledSources.ts tests/unit/LiveTranscript.dom.test.tsx tests/unit/eouTranscriptProjection.test.ts
git commit -m "test(transcript): reproduce jumbled dual-source live revisions (#670)"
```

---

### Task 2: Make the EOU projection chronological and provenance-complete

**Files:**
- Modify: `src/services/liveTranscription/eouTranscriptProjection.ts`
- Modify: `src/components/features/recordingWorkspaceModel.ts`
- Modify: `tests/unit/eouTranscriptProjection.test.ts`
- Modify: `tests/unit/eouRendererSession.test.ts`

- [ ] **Step 1: Add source revision metadata to raw live rows**

Extend `LiveTranscriptSegment` with optional presentation-neutral provenance:

```ts
sourceRevision?: {
  streamId: string;
  generation: number;
  revision: number;
  processedAudioMs: number;
  kind: 'committed' | 'tentative';
};
```

Populate it in `makeSegment`. Keep `toStoredLiveTranscriptCandidate` unchanged so this renderer metadata is not persisted into canonical transcript JSON.

- [ ] **Step 2: Remove global confirmed-first ordering**

Sort projected rows by `timestampMs`, then source rank, revision, and ID. Never use `confirmed` as a global ordering key.

- [ ] **Step 3: Prove stale revisions and immutable committed prefixes still fail closed**

Keep existing generation, duplicate revision, and `parakeet_prefix_mutated` tests passing. Add a test that a tentative replacement retains the same raw row ID while a newly committed suffix receives a durable ID.

- [ ] **Step 4: Run focused tests**

```bash
pnpm vitest run tests/unit/eouTranscriptProjection.test.ts tests/unit/eouRendererSession.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/liveTranscription/eouTranscriptProjection.ts src/components/features/recordingWorkspaceModel.ts tests/unit/eouTranscriptProjection.test.ts tests/unit/eouRendererSession.test.ts
git commit -m "fix(transcript): preserve chronological raw EOU projection (#670)"
```

---

### Task 3: Reconcile raw rows into multiple stable reading fragments

**Files:**
- Create: `src/services/liveTranscription/liveTranscriptReadingFragments.ts`
- Modify: `src/services/liveTranscription/liveTranscriptReconciliation.ts`
- Modify: `src/services/liveTranscription/liveEchoSubsequenceAlignment.ts`
- Modify: `src/services/liveTranscription/liveEchoTokenAlignment.ts`
- Modify: `tests/unit/liveTranscriptReconciliation.test.ts`
- Create: `tests/unit/liveTranscriptReadingFragments.test.ts`

- [ ] **Step 1: Write failing tests for disjoint spans**

Cover one long mic row containing `remote A → local reply → remote B → local reply → remote C`. Assert that reconciliation emits three suppressed ranges and two visible mic fragments with word-level timestamps. Add fail-closed cases for negation, numbers, currency, reordered phrases, mixed overlap, missing word timing, and acoustic evidence that supports only one channel.

- [ ] **Step 2: Add a range-first reconciliation result**

Introduce:

```ts
export type LiveEchoMatchRange = {
  sourceSegmentId: string;
  startWord: number;
  endWord: number;
  matchedSegmentIds: string[];
  confidence: number;
};

export type LiveTranscriptReconciliation = {
  segments: LiveTranscriptSegment[];
  fragments: LiveReadingFragment[];
  suppressedRanges: LiveEchoMatchRange[];
};
```

Add `reconcileLiveTranscriptReading(...)`. Keep `reconcileLiveTranscriptSegments(...)` temporarily as a compatibility wrapper for callers outside the recording surface.

- [ ] **Step 3: Generalize from one best span to non-overlapping ranges**

Collect all acoustically and lexically supported matches for each mic row, sort by word range, reject overlaps, and choose the deterministic set with the greatest supported remote-word coverage. Protected polarity, numeric, symbol, and unmatched local words are never suppressed. Cap work at 256 tokens and six adjacent rows as today.

- [ ] **Step 4: Build visible fragments without mutating raw rows**

Split retained word ranges into `LiveReadingFragment` records. Use IDs of the form `${sourceSegmentId}:words:${start}-${end}` so identical evidence retains DOM identity across revisions. System rows yield raw visible fragments; fully matched mic rows yield none.

- [ ] **Step 5: Run focused reconciliation tests**

```bash
pnpm vitest run tests/unit/liveTranscriptReconciliation.test.ts tests/unit/liveTranscriptReadingFragments.test.ts tests/unit/liveEchoEvidence.test.ts
```

Expected: PASS with the existing conservative safeguards unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/services/liveTranscription tests/unit/liveTranscriptReconciliation.test.ts tests/unit/liveTranscriptReadingFragments.test.ts tests/unit/liveEchoEvidence.test.ts
git commit -m "fix(transcript): reconcile disjoint echo spans into reading fragments (#670)"
```

---

### Task 4: Add the meeting-scoped append-only conversation projector

**Files:**
- Create: `src/services/liveTranscription/liveConversationProjection.ts`
- Create: `tests/unit/liveConversationProjection.test.ts`

- [ ] **Step 1: Write state-machine tests before implementation**

Cover:

- tentative revisions replace only `draft`;
- confirmed fragments append to `history` exactly once;
- previously appended turn IDs and text remain byte-for-byte stable;
- same-speaker adjacent confirmed fragments merge only before the turn is first emitted;
- a late confirmed fragment appends with `arrival: 'late'` and its original timestamp;
- draft text is bounded to the latest 18 words and never duplicates history;
- simultaneous mic and System tentative fragments produce one `Listening now` draft;
- `reset(generation)` clears all state and stale generations are ignored.

- [ ] **Step 2: Implement the projector as a pure meeting-local state machine**

```ts
export function createLiveConversationProjection(): {
  apply(input: {
    generation: number;
    fragments: LiveReadingFragment[];
  }): LiveConversationView;
  reset(generation: number): void;
};
```

Maintain an emitted-fragment set and immutable history snapshots. Do not infer speaker identity from text. Map mic to `You`, System to `Call`, and mixed drafts to `Listening now`.

- [ ] **Step 3: Run projector tests**

```bash
pnpm vitest run tests/unit/liveConversationProjection.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/services/liveTranscription/liveConversationProjection.ts tests/unit/liveConversationProjection.test.ts
git commit -m "feat(transcript): add append-only live conversation projection (#670)"
```

---

### Task 5: Wire one reading model through AudioManager and the workspace

**Files:**
- Modify: `src/components/AudioManager.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/features/ZenMode.tsx`
- Modify: `src/components/features/recordingWorkspaceModel.ts`
- Modify: `tests/unit/audioManagerParakeetEouWiring.test.ts`
- Modify: `tests/unit/recordingWorkspaceModel.test.ts`
- Modify: `tests/unit/AppRecordingNavigation.dom.test.tsx`

- [ ] **Step 1: Change the renderer callback contract**

Replace `onLiveTranscript(segments)` with `onLiveConversation(view)` through `AudioManager`, `App`, and `ZenMode`. Keep raw `segments` inside `AudioManager` for persistence, meeting-context ingestion, and finalization.

- [ ] **Step 2: Create and reset one projector per capture generation**

In the EOU `onSegments` callback, call `reconcileLiveTranscriptReading`, then apply its fragments to the conversation projector. Echo-evidence-only revisions may update the draft but may not remove or rewrite history.

- [ ] **Step 3: Protect downstream canonical consumers**

Assert in wiring tests that `processedMicSegmentsRef`, `toStoredLiveTranscriptCandidate`, `meetingContextIngestion.accept`, and incremental-notes input still consume raw segments rather than reading fragments or frozen history.

- [ ] **Step 4: Run focused wiring tests**

```bash
pnpm vitest run tests/unit/audioManagerParakeetEouWiring.test.ts tests/unit/recordingWorkspaceModel.test.ts tests/unit/AppRecordingNavigation.dom.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AudioManager.tsx src/App.tsx src/components/features/ZenMode.tsx src/components/features/recordingWorkspaceModel.ts tests/unit/audioManagerParakeetEouWiring.test.ts tests/unit/recordingWorkspaceModel.test.ts tests/unit/AppRecordingNavigation.dom.test.tsx
git commit -m "refactor(transcript): publish one stable live conversation view (#670)"
```

---

### Task 6: Render settled history and one calm draft

**Files:**
- Modify: `src/components/features/LiveTranscript.tsx`
- Modify: `src/components/features/liveTranscriptPresentation.ts`
- Modify: `src/index.css`
- Modify: `tests/unit/liveTranscriptPresentation.test.ts`
- Modify: `tests/unit/LiveTranscript.dom.test.tsx`

- [ ] **Step 1: Replace flat segment rendering with explicit history and draft regions**

Render history turns as keyed `<article data-turn-id={turn.id}>` nodes. Render one `<aside data-live-draft aria-live="polite" aria-atomic="true">` after history. Do not put the history list in a live region.

- [ ] **Step 2: Apply the agreed copy and hierarchy**

- Heading status: `Listening`, `Reviewing earlier`, `Falling behind`, or `Caught up`.
- Draft label: `You`, `Call`, or `Listening now`.
- Draft secondary copy: `Refining last words`.
- Late confirmed turn qualifier: `Earlier speech · 00:14`.
- Keep `Return to live`; do not force-scroll while the user is reviewing history.

- [ ] **Step 3: Style the draft as one anchored mutable surface**

Use existing typography and neutral tokens. Give the draft a subtle top rule and muted background tint; avoid bubbles, source colors, pulsing text, typewriter effects, and movement animations. Preserve `prefers-reduced-motion` behavior and the existing 760px responsive rule.

- [ ] **Step 4: Add DOM and accessibility assertions**

Assert one draft, stable history node identity across rerenders, no duplicate phrases, correct labels, no history `aria-live`, draft `aria-live="polite"`, keyboard-operable `Return to live`, and no automatic scrolling after manual review.

- [ ] **Step 5: Run focused renderer tests**

```bash
pnpm vitest run tests/unit/liveTranscriptPresentation.test.ts tests/unit/LiveTranscript.dom.test.tsx
```

Expected: PASS, including the Sep 5 topology fixture.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/LiveTranscript.tsx src/components/features/liveTranscriptPresentation.ts src/index.css tests/unit/liveTranscriptPresentation.test.ts tests/unit/LiveTranscript.dom.test.tsx
git commit -m "feat(transcript): render stable history with one live draft (#670)"
```

---

### Task 7: Add bounded diagnostics and rollout gates

**Files:**
- Create: `src/services/liveTranscription/liveConversationDiagnostics.ts`
- Modify: `src/components/AudioManager.tsx`
- Modify: `electron/main.ts`
- Create: `tests/unit/liveConversationDiagnostics.test.ts`
- Create: `tests/unit/liveConversationRollout.test.ts`
- Create: `docs/changelog/entries/2026-09-05-stable-live-transcript.md`

- [ ] **Step 1: Add content-free counters**

Track only counts and durations: raw mic/System rows, visible fragments, suppressed ranges, late arrivals, draft revisions, maximum draft words, history mutation attempts, and reconciliation time. Never log text, meeting IDs, word timings, audio paths, or acoustic values.

- [ ] **Step 2: Fail closed on invariant violations**

If a projector revision would mutate history, retain the prior history, publish the newest bounded draft, increment `historyMutationPrevented`, and keep recording healthy. Do not throw through the capture path.

- [ ] **Step 3: Add rollout documentation**

Document the renderer-only trust boundary, fallback behavior, and the acceptance gate in the changelog fragment. Add a main-process `LIVE_TRANSCRIPT_GET_ROLLOUT` handler backed by the existing settings store and ship the new projection behind `stable_live_conversation_v1` for dogfood; the fallback is the current presentation path. Do not expose a user-facing toggle and do not remove the fallback until Task 8 passes.

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run tests/unit/liveConversationDiagnostics.test.ts tests/unit/liveConversationRollout.test.ts tests/unit/audioManagerParakeetEouWiring.test.ts
pnpm run changelog:check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/liveTranscription/liveConversationDiagnostics.ts src/components/AudioManager.tsx electron/main.ts tests/unit/liveConversationDiagnostics.test.ts tests/unit/liveConversationRollout.test.ts docs/changelog/entries/2026-09-05-stable-live-transcript.md
git commit -m "chore(transcript): add stable conversation rollout diagnostics (#670)"
```

---

### Task 8: Verify synthetic, repository, and real-meeting acceptance

**Files:**
- Modify: `tests/manual/parakeetEouCausalReplay.test.ts`
- Create: `docs/qa/live-transcript-stable-conversation.md`

- [ ] **Step 1: Add causal replay invariants**

Extend the manual replay to feed revisions incrementally and report content-free counts. Require zero history mutation attempts, one maximum live draft, bounded queue depth, and no raw prefix mutation.

- [ ] **Step 2: Run focused and full automated gates**

```bash
pnpm vitest run tests/unit/eouTranscriptProjection.test.ts tests/unit/eouRendererSession.test.ts tests/unit/liveEchoEvidence.test.ts tests/unit/liveTranscriptReconciliation.test.ts tests/unit/liveTranscriptReadingFragments.test.ts tests/unit/liveConversationProjection.test.ts tests/unit/liveConversationDiagnostics.test.ts tests/unit/liveTranscriptPresentation.test.ts tests/unit/LiveTranscript.dom.test.tsx tests/unit/audioManagerParakeetEouWiring.test.ts
pnpm exec tsc --noEmit
pnpm run lint
pnpm run changelog:check
pnpm run test -- --run
```

Expected: all gates PASS. If Node tests rebuild `better-sqlite3`, run `pnpm run ensure:sqlite-abi` before Electron acceptance.

- [ ] **Step 3: Run private causal replay**

```bash
pnpm run benchmark:private-parakeet-eou:validate
pnpm run replay:parakeet-eou
```

Expected: no prefix mutation, no history mutation, one draft maximum, and no content-bearing committed artifact.

- [ ] **Step 4: Perform rendered Electron acceptance with fresh recordings**

Run `pnpm start` and record five consented cases: headphones, remote-only loudspeaker, alternating local/remote, genuine overlap, and a sustained remote monologue with short local interruptions. For every revision, verify:

- settled rows never move;
- only the bottom draft revises;
- no phrase appears twice simultaneously;
- local interruptions survive;
- remote echo appears once;
- `Return to live` respects manual review;
- stopping the meeting still produces the trusted final transcript.

Record only pass/fail observations and content-free counters in `docs/qa/live-transcript-stable-conversation.md`.

- [ ] **Step 5: Remove the fallback only after acceptance**

After all five cases pass, make `stable_live_conversation_v1` the default, retain an emergency disable setting for one release, and close #670 with exact test commands and fresh real-meeting evidence. If any case fails, leave the flag default-off and keep #670 open.

- [ ] **Step 6: Commit verification artifacts**

```bash
git add tests/manual/parakeetEouCausalReplay.test.ts docs/qa/live-transcript-stable-conversation.md
git commit -m "test(transcript): verify stable conversation acceptance (#670)"
```

---

## Definition of done

- The normal live view contains append-only history and no more than one mutable draft.
- No fixture or real-meeting revision reorders an existing history DOM node.
- Echo suppression can remove several disjoint remote spans from one mic EOU buffer without deleting protected local wording.
- Raw dual-source evidence, final transcription, meeting-context ingestion, and notes inputs remain unchanged.
- The five fresh rendered acceptance recordings pass before default enablement.
- Live voice naming is not required for this outcome and remains isolated in #770.
