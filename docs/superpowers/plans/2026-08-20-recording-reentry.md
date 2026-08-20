# Recording Re-entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user return to an active recording from the sidebar after leaving the recording workspace.

**Architecture:** `App` already owns the recording lifecycle and whether Zen mode is visible. It will pass a derived re-entry state and callback to `Sidebar`. The sidebar primary action will switch labels and behavior only while an active recording is hidden; it will not touch capture or finalization.

**Tech Stack:** React, TypeScript, Vitest, happy-dom, Tailwind utility classes.

---

### Task 1: Sidebar recording re-entry

**Files:**
- Modify: `tests/unit/AppRecordingNavigation.dom.test.tsx:145-198`
- Modify: `src/App.tsx:805-822`
- Modify: `src/components/layout/Sidebar.tsx:21-91`
- Create: `docs/changelog/entries/2026-08-20-645-recording-reentry.md`

- [ ] **Step 1: Write the failing DOM regression test**

Replace the obsolete header-popover assertions after `Back home` with this behavior:

```ts
const returnToRecording = Array.from(container.querySelectorAll('button')).find(
  (button) => button.textContent?.includes('Return to recording'),
);
expect(returnToRecording).not.toBeUndefined();

await act(async () => {
  returnToRecording?.click();
  await flushPromises();
});
expect(container.textContent).toContain('Back home');
expect(container.textContent).toContain('Live transcript');
```

- [ ] **Step 2: Run the test to verify the observed regression**

Run: `pnpm exec vitest run tests/unit/AppRecordingNavigation.dom.test.tsx --reporter=dot`

Expected: FAIL because the sidebar has no `Return to recording` action after Back home.

- [ ] **Step 3: Add the minimal state and callback plumbing**

In `App`, pass `isRecordingActive={activeRecording}` and `onReturnToRecording={() => setZenVisible(true)}` to `Sidebar`. In `Sidebar`, add those props and derive the button action/label from `isRecordingActive`: use `onReturnToRecording` and `Return to recording` while true; otherwise retain `onStartRecording` and `New meeting`.

- [ ] **Step 4: Add the changelog fragment**

Create a content-free entry documenting that a live recording can be reopened from sidebar navigation.

- [ ] **Step 5: Run focused verification**

Run: `pnpm exec vitest run tests/unit/AppRecordingNavigation.dom.test.tsx --reporter=dot`

Expected: PASS with both DOM tests passing.

- [ ] **Step 6: Run type and lint verification**

Run: `pnpm run lint`

Expected: exit 0 with no lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/layout/Sidebar.tsx tests/unit/AppRecordingNavigation.dom.test.tsx docs/changelog/entries/2026-08-20-645-recording-reentry.md docs/superpowers/plans/2026-08-20-recording-reentry.md
git commit -m "fix: restore active recording re-entry"
```
