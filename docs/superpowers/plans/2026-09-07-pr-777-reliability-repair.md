# PR #777 Reliability Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase and narrow PR #777 so it safely ships meeting-notes recovery, durable publication notifications, and best-effort terminal metrics without changing speaker identity behavior.

**Architecture:** Keep the compact Ollama writer/audit recovery inside `meetingNotesPipeline` and keep publication notification and metric isolation inside `meetingAnalysisRuns`. Restore the existing transcript/identity projection unchanged; trusted speaker names will be implemented separately under issue #782 at the real `NotesSource` serialization boundary.

**Tech Stack:** TypeScript, Electron, Vitest, Biome, Ollama replay harness.

---

### Task 1: Remove the unsafe speaker-name scope

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/meetingAnalysisRuns.ts`
- Restore: `src/components/features/meetingTranscriptPresentation.ts`
- Restore: `src/utils/transcript.ts`
- Delete: `src/utils/meetingSpeakerNames.ts`
- Modify: `tests/unit/meetingAnalysisRuns.test.ts`
- Restore: `tests/unit/transcript.test.ts`

- [x] **Step 1: Restore transcript identity behavior**

Restore the three files marked Restore—`src/components/features/meetingTranscriptPresentation.ts`, `src/utils/transcript.ts`, and `tests/unit/transcript.test.ts`—to their `origin/master` versions and remove the new `meetingSpeakerNames.ts`. This preserves ambiguous `mappingApplied:false` rows as `Speaker` and leaves the #782 work out of #777.

- [x] **Step 2: Remove coordinator identity injection**

Remove `getSpeakerDisplayNames`, `speakerDisplayNames`, and the associated transcript arguments/cache identity from `electron/main.ts` and `electron/meetingAnalysisRuns.ts`. Preserve `onPublished`, `announcePublication`, and the metric `try/catch` exactly.

- [x] **Step 3: Remove speaker-name-only tests and verify the focused suite**

Remove only tests and expectations that exercise `getSpeakerDisplayNames` or `speakerDisplayNames`. Run:

```bash
pnpm exec vitest run tests/unit/meetingAnalysisRuns.test.ts tests/unit/transcript.test.ts
```

Expected: PASS, with the baseline anonymous attribution tests unchanged.

- [x] **Step 4: Commit**

```bash
git add electron/main.ts electron/meetingAnalysisRuns.ts src/components/features/meetingTranscriptPresentation.ts src/utils/transcript.ts tests/unit/meetingAnalysisRuns.test.ts tests/unit/transcript.test.ts
git rm src/utils/meetingSpeakerNames.ts
git commit -m "fix: keep notes recovery separate from speaker identity"
```

### Task 2: Prove publication notification terminal behavior

**Files:**
- Modify: `tests/unit/meetingAnalysisRuns.test.ts`
- Modify only if a regression fails: `electron/meetingAnalysisRuns.ts`

- [x] **Step 1: Add terminal-state regression tests**

Add focused tests proving `onPublished` is not called for failed, cancelled, or superseded runs, and that multiple subscribers to one coalesced run produce exactly one callback for the durable run ID.

- [x] **Step 2: Run the new tests before production edits**

```bash
pnpm exec vitest run tests/unit/meetingAnalysisRuns.test.ts
```

Expected: the tests either expose a missing terminal guard and fail for that reason, or confirm the peer implementation already meets the acceptance criterion. Do not change production code unless a test fails.

- [x] **Step 3: Apply the minimal production fix if required**

Keep the callback immediately after `publishMeetingNotesIfCurrent` succeeds, after metric finalization and durable publication, and before optional secondary work. The callback wrapper must swallow notification errors so publication remains the primary outcome.

- [x] **Step 4: Re-run and commit**

```bash
pnpm exec vitest run tests/unit/meetingAnalysisRuns.test.ts
git add tests/unit/meetingAnalysisRuns.test.ts electron/meetingAnalysisRuns.ts
git commit -m "test: cover notes publication notification terminal states"
```

### Task 3: Verify recovery safety and prepare delivery

**Files:**
- Modify: `electron/llm/meetingNotesPipeline.ts` (formatting only unless a test fails)
- Modify: `docs/changelog/entries/2026-09-06-776-notes-publication-notification.md`

- [x] **Step 1: Run focused reliability tests**

```bash
pnpm exec vitest run tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingAnalysisRuns.test.ts tests/unit/transcript.test.ts
```

Expected: writer truncation retries once; editor truncation/schema/guardrail failure publishes only a deterministically accepted draft; invalid sources and inherited commitments remain fail-closed; notifications occur once after publication.

- [x] **Step 2: Run static verification**

```bash
pnpm exec biome check electron/llm/meetingNotesPipeline.ts electron/meetingAnalysisRuns.ts electron/main.ts tests/unit/meetingNotesPipeline.test.ts tests/unit/meetingAnalysisRuns.test.ts
pnpm exec tsc --noEmit
pnpm run changelog:check
git diff --check origin/master...HEAD
```

Expected: all commands exit 0.

- [x] **Step 3: Update the changelog wording**

Ensure the fragment describes only safe draft recovery, durable readiness notification, and best-effort metrics, and links issue #776. It must not claim speaker-name propagation.

- [x] **Step 4: Commit delivery cleanup**

```bash
git add electron/llm/meetingNotesPipeline.ts docs/changelog/entries/2026-09-06-776-notes-publication-notification.md docs/superpowers/plans/2026-09-07-pr-777-reliability-repair.md
git commit -m "docs: narrow notes reliability delivery scope"
```

### Task 4: Post-merge evaluation

**Files:**
- Modify after merge: `docs/research/2026-09-06-local-intelligence-16gb-evaluation-results.md`

- [ ] **Step 1: Rerun the complete Phi/Gemma notes suite from merged source**

Use the committed private-manifest replay workflow from #780 with exact model digests and record raw artifacts under `.private/`. Do not overwrite the frozen baseline artifacts.

- [ ] **Step 2: Append a dated post-#777 system-comparison addendum**

Report pass counts, medians, warning/fallback provenance, and clearly distinguish the changed pipeline from a model-only rerun.

- [ ] **Step 3: Open and merge the evaluation addendum PR after verification**

Keep model residency/switching as the next separate implementation blocker regardless of notes quality outcome.
