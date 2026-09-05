# Single Them Speaker Identification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users identify a single remote participant represented canonically as `Them`, from both the meeting header and transcript, without inventing a numbered speaker label.

**Architecture:** Centralize the selection of reviewable anonymous speakers in `speakerReview.ts`: numbered remote speakers take precedence, otherwise `Them` is the sole review target. Reuse the existing meeting-scoped identity binding and display-name projection paths so persistence remains reversible and the canonical transcript remains unchanged.

**Tech Stack:** TypeScript, React, Electron renderer IPC, Vitest, React DOM test utilities.

---

### Task 1: Centralize reviewable-speaker policy

**Files:**
- Modify: `src/utils/speakerReview.ts`
- Test: `tests/unit/speakerReview.test.ts`

- [ ] **Step 1: Write failing policy and sample-selection tests**

Add `selectReviewableAnonymousSpeakers` to the test import and cover numbered precedence, aggregate fallback, exclusions, deduplication, and `Them` samples:

```ts
expect(
  selectReviewableAnonymousSpeakers([
    'Me',
    'Them',
    'Remote Speaker 2',
    'Remote Speaker 2',
    'Remote Speaker 1',
  ]),
).toEqual(['Remote Speaker 2', 'Remote Speaker 1']);
expect(selectReviewableAnonymousSpeakers(['Me', 'Them', 'Unknown'])).toEqual([
  'Them',
]);
expect(
  selectReviewableAnonymousSpeakers(['Me', 'Unknown', 'Local Speaker 1']),
).toEqual([]);
expect(
  selectSpeakerSampleIntervals(
    [{ speaker: 'Them', start: 3, end: 7, text: 'Aggregate remote sample.' }],
    'Them',
  ),
).toEqual([{ startSec: 3, endSec: 7, excerpt: 'Aggregate remote sample.' }]);
```

- [ ] **Step 2: Run the unit test and verify red**

Run: `pnpm exec vitest run tests/unit/speakerReview.test.ts`

Expected: FAIL because `selectReviewableAnonymousSpeakers` is not exported and `Them` currently produces no sample.

- [ ] **Step 3: Implement the minimal shared policy**

Add this export next to the other review helpers, preserving first-seen order:

```ts
export const selectReviewableAnonymousSpeakers = (
  speakers: Iterable<string>,
): string[] => {
  const unique = [...new Set([...speakers].map((speaker) => speaker.trim()))]
    .filter(Boolean);
  const numbered = unique.filter((speaker) =>
    REMOTE_SPEAKER_PATTERN.test(speaker),
  );
  if (numbered.length > 0) return numbered;
  return unique.includes('Them') ? ['Them'] : [];
};
```

Change the sample guard to accept only numbered remote labels or exact canonical `Them`:

```ts
if (
  (!REMOTE_SPEAKER_PATTERN.test(speaker) && speaker !== 'Them') ||
  limit <= 0
) {
  return [];
}
```

- [ ] **Step 4: Run the unit test and verify green**

Run: `pnpm exec vitest run tests/unit/speakerReview.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the policy**

```bash
git add src/utils/speakerReview.ts tests/unit/speakerReview.test.ts
git commit -m "fix: make aggregate them speaker reviewable"
```

### Task 2: Use the policy in the guided identity-review modal

**Files:**
- Modify: `src/components/features/SpeakerIdentificationModal.tsx`
- Test: `tests/unit/SpeakerIdentificationModal.dom.test.tsx`

- [ ] **Step 1: Write a failing DOM test for aggregate `Them`**

Add a modal case whose identity state has `speakers: ['Me', 'Them']`. Assert the review UI shows one anonymous speaker named `Them` and can bind it:

```ts
expect(document.body.textContent).toContain('Them');
expect(document.body.textContent).toContain('Speaker 1 of 1');
await choosePerson('person-a');
expect(setMeetingIdentityBinding).toHaveBeenCalledWith(
  'meeting-1',
  'Them',
  { kind: 'person', personId: 'person-a' },
  1,
);
```

- [ ] **Step 2: Run the focused DOM tests and verify red**

Run: `pnpm exec vitest run tests/unit/SpeakerIdentificationModal.dom.test.tsx`

Expected: FAIL because the guided modal currently selects only `Remote Speaker N`.

- [ ] **Step 3: Replace local regex filters with the shared selector**

Import `selectReviewableAnonymousSpeakers` in the modal and replace `remoteSpeakers` with:

```ts
const reviewableSpeakers = useMemo(
  () => selectReviewableAnonymousSpeakers(state?.speakers ?? []),
  [state],
);
```

Use `reviewableSpeakers` for initial-speaker selection, current speaker, count, navigation, and summary. Keep `MeetingIdentityControls` unchanged because its existing aggregate-channel correction path enforces explicit individual-scope confirmation and is separate from the guided meeting modal.

- [ ] **Step 4: Run the focused DOM tests and verify green**

Run: `pnpm exec vitest run tests/unit/SpeakerIdentificationModal.dom.test.tsx tests/unit/IdentityControls.dom.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the review surfaces**

```bash
git add src/components/features/SpeakerIdentificationModal.tsx tests/unit/SpeakerIdentificationModal.dom.test.tsx docs/superpowers/plans/2026-09-05-single-them-speaker-identification.md
git commit -m "fix: review them in speaker identity modal"
```

### Task 3: Add header and transcript entry points

**Files:**
- Modify: `src/components/features/MeetingView.tsx`
- Test: `tests/unit/MeetingViewProgressiveReveal.dom.test.tsx`

- [ ] **Step 1: Write a failing meeting-view interaction test**

Render a meeting whose transcript contains `Me` and `Them`, mock identity state with `speakers: ['Me', 'Them']`, then assert:

```ts
expect(findButton('1 unidentified speaker')?.textContent).toContain(
  '1 unidentified speaker',
);
await clickSpeakerLabel('Them');
expect(document.body.textContent).toContain('Identify Them');
```

Also cover that a transcript containing both `Them` and `Remote Speaker 1` reviews only the numbered speaker.

- [ ] **Step 2: Run the meeting-view test and verify red**

Run: `pnpm exec vitest run tests/unit/MeetingViewProgressiveReveal.dom.test.tsx`

Expected: FAIL because the header and clickable transcript-label logic currently recognize only numbered speakers.

- [ ] **Step 3: Derive one canonical review list and reuse it**

Import the shared selector and compute:

```ts
const reviewableSpeakers = selectReviewableAnonymousSpeakers(
  Object.keys(speakerSummaries),
);
const unidentifiedSpeakerCount = reviewableSpeakers.filter(
  (speaker) => !displayNames[speaker],
).length;
```

For each projected transcript turn, resolve a clickable canonical review key without changing displayed text:

```ts
const numberedMatch = speakerLabel.match(/^Speaker (\d+)$/u);
const reviewSpeaker = numberedMatch
  ? `Remote Speaker ${numberedMatch[1]}`
  : speakerLabel === 'Them'
    ? 'Them'
    : null;
const isAnonymousSpeaker = Boolean(
  reviewSpeaker && reviewableSpeakers.includes(reviewSpeaker),
);
```

On click, pass `reviewSpeaker` to `setSelectedSpeakerForModal` and open the existing modal. Bound projected person names, `Me`, `Unknown`, and local-speaker labels remain non-clickable.

- [ ] **Step 4: Run the meeting-view test and verify green**

Run: `pnpm exec vitest run tests/unit/MeetingViewProgressiveReveal.dom.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the meeting entry points**

```bash
git add src/components/features/MeetingView.tsx tests/unit/MeetingViewProgressiveReveal.dom.test.tsx
git commit -m "fix: identify them from meeting transcript"
```

### Task 4: Record the product rule and verify the change

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-09-05-identify-single-them-speaker.md`

- [ ] **Step 1: Record the durable decision**

Append a dated decision stating: numbered remote clusters remain preferred; when none exist, canonical `Them` is one reviewable remote participant; identity binding changes display projection only; no numbered identity is invented.

- [ ] **Step 2: Add the changelog fragment**

Create the fragment with this user-visible summary:

```md
Fixed speaker identification for meetings where the remote side is represented as `Them`: the meeting header and transcript now open the existing identity review flow without inventing a numbered speaker label.
```

- [ ] **Step 3: Run formatting, focused regression tests, and type checking**

Run:

```bash
pnpm exec prettier --check src/utils/speakerReview.ts src/components/features/SpeakerIdentificationModal.tsx src/components/features/MeetingIdentityControls.tsx src/components/features/MeetingView.tsx tests/unit/speakerReview.test.ts tests/unit/SpeakerIdentificationModal.dom.test.tsx tests/unit/IdentityControls.dom.test.tsx tests/unit/MeetingViewProgressiveReveal.dom.test.tsx docs/decisions.md docs/changelog/entries/2026-09-05-identify-single-them-speaker.md
pnpm exec vitest run tests/unit/speakerReview.test.ts tests/unit/SpeakerIdentificationModal.dom.test.tsx tests/unit/IdentityControls.dom.test.tsx tests/unit/MeetingViewProgressiveReveal.dom.test.tsx tests/unit/identityHandlers.test.ts
pnpm exec tsc --noEmit
```

Expected: formatting check passes; all focused tests pass; typecheck passes or any unrelated pre-existing failure is captured verbatim.

- [ ] **Step 4: Inspect the final diff and status**

Run: `git diff --check && git diff --stat && git status --short`

Expected: no whitespace errors; only issue #761 implementation, tests, decision, changelog, spec, and plan are present.

- [ ] **Step 5: Commit documentation and final verification state**

```bash
git add docs/decisions.md docs/changelog/entries/2026-09-05-identify-single-them-speaker.md docs/superpowers/plans/2026-09-05-single-them-speaker-identification.md
git commit -m "docs: record aggregate speaker review rule"
```
