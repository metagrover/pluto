# Meeting Failure Pattern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated, indefinite meeting failure surfaces with one understated inline recovery notice and one context-specific retry action.

**Architecture:** `MeetingView` remains the one owner of document-level status. A small presentation resolver selects one content-safe notice from transcript trust and downstream-processing state. The notes surface receives a non-rendering blocked state when that notice owns the page. The existing retry callback remains the action boundary.

**Tech Stack:** React, TypeScript, Tailwind/CSS tokens, Vitest.

---

### Task 1: Define one document-level failure presentation

**Files:**
- Create: `src/components/features/meetingFailurePresentation.ts`
- Create: `tests/unit/meetingFailurePresentation.test.ts`

- [ ] **Step 1: Write failing presentation tests**

```ts
expect(resolveMeetingFailurePresentation({ retryableFinalTranscription: true })).toMatchObject({ title: 'Transcript needs another pass', actionLabel: 'Retry transcription' });
expect(resolveMeetingFailurePresentation({ captureRecoveryRequired: true })).toMatchObject({ title: 'Recording saved', actionLabel: null });
expect(resolveMeetingFailurePresentation({ downstreamFailed: true })).toMatchObject({ title: 'Analysis needs another pass', actionLabel: 'Retry analysis' });
```

- [ ] **Step 2: Run the resolver test and verify it fails**

Run: `pnpm exec vitest run tests/unit/meetingFailurePresentation.test.ts --reporter=dot`

Expected: FAIL because `meetingFailurePresentation.ts` does not exist.

- [ ] **Step 3: Implement the content-safe resolver**

```ts
export const resolveMeetingFailurePresentation = (input) => input.retryableFinalTranscription ? { title: 'Transcript needs another pass', detail: 'Your recording is safe.', actionLabel: 'Retry transcription' } : input.captureRecoveryRequired ? { title: 'Recording saved', detail: "Pluto couldn't finish the transcript. Your recording is safe.", actionLabel: null } : input.downstreamFailed ? { title: 'Analysis needs another pass', detail: 'Your transcript is ready. Retry when you are ready.', actionLabel: 'Retry analysis' } : null;
```

- [ ] **Step 4: Run the resolver test and verify it passes**

Run: `pnpm exec vitest run tests/unit/meetingFailurePresentation.test.ts --reporter=dot`

Expected: PASS.

### Task 2: Render exactly one inline recovery notice

**Files:**
- Modify: `src/components/features/MeetingView.tsx`
- Modify: `src/components/features/downstreamProcessingPresentation.ts`
- Modify: `src/index.css`
- Modify: `tests/unit/MeetingViewTranscriptIntegrity.test.tsx`
- Modify: `tests/unit/downstreamProcessingPresentation.test.ts`

- [ ] **Step 1: Write failing document tests**

```tsx
expect(markup).toContain('Transcript needs another pass');
expect(markup).toContain('Retry transcription');
expect(markup.match(/Transcript needs another pass/g)).toHaveLength(1);
expect(markup).not.toContain('data-meeting-skeleton="analysis"');
```

- [ ] **Step 2: Run the document tests and verify they fail**

Run: `pnpm exec vitest run tests/unit/MeetingViewTranscriptIntegrity.test.tsx tests/unit/downstreamProcessingPresentation.test.ts --reporter=dot`

Expected: FAIL because the old title/copy and duplicate notes failure state remain.

- [ ] **Step 3: Render the notice after metadata and block duplicate notes status**

```tsx
<MeetingFailureNotice presentation={failurePresentation} onRetry={onRetry} retrying={retrying} />
```

Set downstream presentation to `{ state: 'blocked' }` whenever a final-transcription failure has been promoted to the document-level notice, so `MeetingAnalysisSkeleton` and `meeting-analysis-error` do not render below it.

- [ ] **Step 4: Style the notice with existing meeting paper tokens**

```css
.meeting-failure-notice { border-top: 1px solid var(--notes-rule); }
.meeting-failure-notice__action { color: var(--notes-ink); background: var(--notes-paper-raised); }
```

Use a compact full-width rule, muted amber status dot, 44px action target, visible focus ring, and no nested card treatment.

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `pnpm exec vitest run tests/unit/meetingFailurePresentation.test.ts tests/unit/MeetingViewTranscriptIntegrity.test.tsx tests/unit/downstreamProcessingPresentation.test.ts --reporter=dot`

Expected: PASS.

### Task 3: Verify the shipped UI

**Files:**
- Create: `docs/changelog/entries/2026-08-20-630-meeting-failure-pattern.md`

- [ ] **Step 1: Add the issue-linked changelog fragment**

Record that failure notices are now single-surface, content-safe, and retryable only when the preserved evidence supports it.

- [ ] **Step 2: Run checks and inspect the failure page**

Run: `pnpm exec vitest run tests/unit/meetingFailurePresentation.test.ts tests/unit/MeetingViewTranscriptIntegrity.test.tsx tests/unit/downstreamProcessingPresentation.test.ts tests/unit/parakeetFinalClient.test.ts --reporter=dot && pnpm run changelog:check && pnpm exec vite build && git diff --check`

Expected: tests and changelog pass; the production bundle builds; diff check is empty.

- [ ] **Step 3: Commit**

```bash
git add src/components/features/meetingFailurePresentation.ts src/components/features/MeetingView.tsx src/components/features/downstreamProcessingPresentation.ts src/index.css tests/unit/meetingFailurePresentation.test.ts tests/unit/MeetingViewTranscriptIntegrity.test.tsx tests/unit/downstreamProcessingPresentation.test.ts docs/changelog/entries/2026-08-20-630-meeting-failure-pattern.md docs/superpowers/plans/2026-08-20-meeting-failure-pattern.md
git commit -m "fix(meetings): unify failure recovery state"
```
