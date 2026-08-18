# Progressive Meeting Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a stopped meeting immediately, show each usable artifact as soon as it exists, and use layout-matched skeletons instead of exposing transcript-validation or recovery workflow states.

**Architecture:** Keep transcript integrity and downstream eligibility unchanged, but map those internal states to a small renderer-only artifact presentation model. `MeetingView` will render the stable meeting header first, a skeleton or ready analysis in the same region, and a skeleton or ready transcript independently; only terminal failures receive compact plain-language copy.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest, happy-dom

---

### Task 1: Define artifact presentation behavior

**Files:**
- Modify: `src/components/features/downstreamProcessingPresentation.ts`
- Test: `tests/unit/downstreamProcessingPresentation.test.ts`

- [ ] **Step 1: Write failing presentation tests**

Add assertions that an unfinished analysis maps to `loading`, ready analysis wins even while later downstream work continues, failure copy contains no validation terminology, and normal states never request a manual retry.

- [ ] **Step 2: Verify the focused test fails**

Run: `pnpm test -- --run tests/unit/downstreamProcessingPresentation.test.ts`

Expected: FAIL because the current model returns `processing` or `missing`, mentions a validated transcript, and exposes retry affordances.

- [ ] **Step 3: Implement the minimal presentation mapping**

Return `loading | failed | ready`; treat persisted analysis as ready regardless of later knowledge stages; use plain artifact language for terminal analysis failure; remove normal-path retry metadata.

- [ ] **Step 4: Verify the focused test passes**

Run: `pnpm test -- --run tests/unit/downstreamProcessingPresentation.test.ts`

Expected: PASS.

### Task 2: Replace pipeline panels with progressive artifact regions

**Files:**
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`
- Create: `tests/unit/MeetingViewProgressiveReveal.dom.test.tsx`

- [ ] **Step 1: Write failing static and mounted tests**

Cover these behaviors: provisional/validating meetings contain no validation, recovery, needs-attention, or retry copy; transcript text renders while analysis is loading; the analysis region has a layout skeleton; an empty transcript region has its own skeleton; updating the same meeting from loading to analyzed replaces the skeleton in place.

- [ ] **Step 2: Verify the tests fail for the intended presentation gaps**

Run: `pnpm test -- --run tests/unit/MeetingViewTranscriptIntegrity.test.tsx tests/unit/MeetingViewProgressiveReveal.dom.test.tsx`

Expected: FAIL on the current warning panels, status badge, missing skeletons, and empty-state copy.

- [ ] **Step 3: Implement final-layout skeleton components and state mapping**

Add accessible `MeetingAnalysisSkeleton` and `MeetingTranscriptSkeleton` components, remove normal validation/downstream warning panels and manual retry controls, replace the status badge with artifact-neutral meeting copy, render ready transcript content independently of internal lifecycle state, and reserve compact plain-language errors for terminal artifact failures.

- [ ] **Step 4: Verify the focused component tests pass**

Run: `pnpm test -- --run tests/unit/MeetingViewTranscriptIntegrity.test.tsx tests/unit/MeetingViewProgressiveReveal.dom.test.tsx`

Expected: PASS.

### Task 3: Open a just-stopped meeting with its transcript region visible

**Files:**
- Modify: `src/App.tsx`
- Modify: `tests/unit/AppRecordingNavigation.dom.test.tsx`

- [ ] **Step 1: Extend the recording navigation test**

Make the mocked recorder complete a persisted meeting and assert that the meeting page opens with the transcript region expanded while ordinary sidebar navigation keeps the existing collapsed default.

- [ ] **Step 2: Verify the navigation test fails**

Run: `pnpm test -- --run tests/unit/AppRecordingNavigation.dom.test.tsx`

Expected: FAIL because the selected-meeting effect currently always collapses the transcript.

- [ ] **Step 3: Implement one-shot post-recording transcript expansion**

Track whether selection came from `onSessionComplete`; consume that one-shot intent in the existing selected-meeting effect and preserve collapsed defaults for other navigation.

- [ ] **Step 4: Verify the navigation test passes**

Run: `pnpm test -- --run tests/unit/AppRecordingNavigation.dom.test.tsx`

Expected: PASS.

### Task 4: Record the product decision and verify the branch

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-08-17-632-progressive-meeting-reveal.md`

- [ ] **Step 1: Record the durable renderer boundary**

Document that validation remains an internal trust boundary while artifact availability—not pipeline vocabulary—drives Meeting View presentation.

- [ ] **Step 2: Add the changelog fragment**

Describe the immediate details-page transition, independent transcript/analysis reveal, and skeleton loading behavior with issue #632 traceability.

- [ ] **Step 3: Run final verification**

Run: `pnpm test -- --run`

Run: `pnpm run lint`

Run: `pnpm run changelog:check`

Expected: all commands pass; the final diff contains only issue #632 implementation, tests, decision, changelog, and this plan.
