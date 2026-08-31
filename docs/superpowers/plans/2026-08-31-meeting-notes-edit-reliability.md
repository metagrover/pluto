# Meeting Notes Edit Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Meeting Notes edits autosave truthfully, cancel safely, remain keyboard accessible, expose explicit row creation, and make deletion recoverable.

**Architecture:** Keep `MeetingNotesDocument` and the existing `native_continuations:<parentPath>` storage contract. Extend `InlineEditableText` with a debounced, serial save lifecycle that reports document-level state, preserves failed drafts, and suppresses blur persistence after Escape. Keep native-continuation creation and deletion in the parent, add a single recoverable deletion record for Undo, and expose restrained controls without introducing a new editor framework.

**Tech Stack:** React 18, TypeScript, `react-textarea-autosize`, Electron IPC, Vitest/happy-dom, Tailwind-backed CSS.

---

### Task 1: Autosave, truthful status, retry, and Escape cancellation

**Files:**
- Modify: `src/components/features/MeetingNotesDocument.tsx:133-579`
- Test: `tests/unit/MeetingNotesDocument.dom.test.tsx`

- [x] **Step 1: Write failing DOM tests**

Add tests that edit an existing block through a native `input` event, advance fake timers past a 650 ms idle delay, and expect `SAVE_USER_EDIT`. Add a deferred/rejected IPC test that asserts `Saving notes`, then `Notes were not saved`, and activates a `Retry save` button. Add an Escape test that changes the textarea, dispatches Escape, and asserts neither `SAVE_USER_EDIT` nor `REVERT_USER_EDIT` was invoked.

```tsx
await changeTextarea(textarea, 'Use docs as reviewed code.');
await act(async () => vi.advanceTimersByTimeAsync(650));
expect(invoke).toHaveBeenCalledWith('SAVE_USER_EDIT', expect.objectContaining({
  edited: 'Use docs as reviewed code.',
}));

textarea.dispatchEvent(new KeyboardEvent('keydown', {
  key: 'Escape',
  bubbles: true,
  cancelable: true,
}));
expect(invoke).not.toHaveBeenCalled();
```

- [x] **Step 2: Verify the new tests fail for the missing behavior**

Run: `pnpm vitest tests/unit/MeetingNotesDocument.dom.test.tsx --run --reporter=dot`

Expected: autosave/retry/Escape assertions fail against the current blur-only lifecycle.

- [x] **Step 3: Implement the serial debounced save lifecycle**

Extend `SaveStatus` with an optional retry callback and pass a state reporter into each editor. Use refs for the idle timer, in-flight request, queued value, edit-session baseline, and one-shot blur suppression. Mark input dirty immediately, persist after 650 ms, flush meaningful changes on blur, keep failed draft text visible, and publish a retry closure with the exact failed value.

```tsx
type SaveStateChange = (state: SaveState, retry?: () => void) => void;

const reportSaveState = (state: SaveState, retry?: () => void) => {
  onSaveStateChange?.(state, retry);
};

const cancelEditing = () => {
  suppressNextBlurSaveRef.current = true;
  clearSaveTimer();
  setDraft(editSessionStartRef.current);
  setError(null);
  reportSaveState('saved');
  textareaRef.current?.blur();
};
```

The textarea remains enabled during background persistence; serial queueing ensures a newer draft cannot be overwritten by an older completion.

- [x] **Step 4: Verify autosave, retry, and cancel tests pass**

Run: `pnpm vitest tests/unit/MeetingNotesDocument.dom.test.tsx --run --reporter=dot`

Expected: all Meeting Notes DOM tests pass with no React act warnings introduced by these cases.

### Task 2: Keyboard access, native spellcheck, and explicit Add item

**Files:**
- Modify: `src/components/features/MeetingNotesDocument.tsx:157-930`
- Modify: `src/index.css:827-1075`
- Test: `tests/unit/MeetingNotesDocument.dom.test.tsx`

- [x] **Step 1: Write failing accessibility and keyboard tests**

Assert editable previews expose an `Edit item` button, activating it focuses the corresponding textarea, `spellcheck` is enabled, Arrow Up from the second editor opens/focuses the previous row, and Arrow/Backspace at a boundary are not prevented when no destination exists. Assert a section-level `Add item` button writes an empty native continuation and requests a document refresh.

```tsx
const event = new KeyboardEvent('keydown', {
  key: 'ArrowUp',
  bubbles: true,
  cancelable: true,
});
textarea.dispatchEvent(event);
expect(event.defaultPrevented).toBe(false);
```

- [x] **Step 2: Verify the keyboard and affordance tests fail**

Run: `pnpm vitest tests/unit/MeetingNotesDocument.dom.test.tsx --run --reporter=dot`

Expected: edit trigger, spellcheck, reliable navigation, and explicit add assertions fail.

- [x] **Step 3: Implement row-level keyboard entry and destination-aware navigation**

Wrap both preview and editing states in `[data-meeting-note-editor]`. Add a separate `Edit item` button beside the preview so Markdown checkboxes are never nested inside a composite button. Replace the textarea-only query with editor-wrapper navigation that activates the adjacent edit trigger and returns a boolean; call `preventDefault()` only when navigation succeeds.

```tsx
const navigateToAdjacentEditor = (
  current: HTMLTextAreaElement,
  direction: 'up' | 'down',
): boolean => {
  const editors = Array.from(document.querySelectorAll('[data-meeting-note-editor]'));
  const currentEditor = current.closest('[data-meeting-note-editor]');
  const index = editors.indexOf(currentEditor as Element);
  const target = editors[direction === 'up' ? index - 1 : index + 1];
  const trigger = target?.querySelector<HTMLButtonElement>('[data-edit-item]');
  const textarea = target?.querySelector<HTMLTextAreaElement>('textarea');
  if (textarea) textarea.focus();
  else trigger?.click();
  return Boolean(textarea || trigger);
};
```

Set `spellCheck` on editable textareas.

- [x] **Step 4: Implement the restrained Add item affordance**

For each section, select its last block eligible for native continuation and render one quiet `Plus` button labeled `Add item`. Reuse `createNativeContinuation(anchor)` and its pending-focus behavior. Hide the affordance when a section has no persistence path.

- [x] **Step 5: Add interaction CSS and verify tests**

Style edit/add controls as low-emphasis text/icon actions with visible `:focus-visible`, at least 40 px interaction height, no extra card surface, and no layout shift when controls receive focus.

Run: `pnpm vitest tests/unit/MeetingNotesDocument.dom.test.tsx --run --reporter=dot`

Expected: keyboard, spellcheck, and add-item tests pass.

### Task 3: Recoverable native-continuation deletion

**Files:**
- Modify: `src/components/features/MeetingNotesDocument.tsx:581-930`
- Modify: `src/index.css:827-1075`
- Test: `tests/unit/MeetingNotesDocument.dom.test.tsx`

- [x] **Step 1: Write failing delete and Undo tests**

Extend the Backspace regression to assert the emptied row is deleted and a live-region message with `Undo` appears. Rerender with the post-delete model, activate Undo, and expect the deleted continuation to be appended to the latest surviving continuation list rather than restoring a stale full snapshot.

```tsx
expect(screenText()).toContain('Item deleted');
await clickButton('Undo');
expect(invoke).toHaveBeenLastCalledWith('SAVE_USER_EDIT', expect.objectContaining({
  edited: JSON.stringify([
    { id: 'survivor', text: 'Keep me' },
    { id: 'temporary', text: 'Temporary item' },
  ]),
}));
```

- [x] **Step 2: Verify delete/Undo tests fail**

Run: `pnpm vitest tests/unit/MeetingNotesDocument.dom.test.tsx --run --reporter=dot`

Expected: deletion persists but no recoverable state or Undo action exists.

- [x] **Step 3: Implement deletion and Undo without stale-list overwrite**

Move empty native-continuation deletion into parent callbacks. Persist removal immediately, store only the deleted record and parent path, show `Item deleted` with `Undo`, and dismiss the recovery affordance after five seconds. On Undo, derive the latest continuation list from the current model, append the deleted record only if absent, persist, refresh, and clear the recovery state.

```tsx
type DeletedContinuation = {
  parentPath: string;
  continuation: NativeMeetingNoteContinuation;
};
```

Do not debounce an empty continuation into deletion while the user is still focused; delete only on explicit empty Backspace or blur.

- [x] **Step 4: Verify deletion, Undo, and existing continuation tests pass**

Run: `pnpm vitest tests/unit/MeetingNotesDocument.dom.test.tsx tests/unit/meetingNotesDocument.test.ts tests/unit/meetingNotesEditRebase.test.ts --run --reporter=dot`

Expected: all focused Meeting Notes tests pass.

### Task 4: Rendered inspection, durable documentation, and final verification

**Files:**
- Create: `docs/changelog/entries/2026-08-31-697-meeting-notes-edit-reliability.md`
- Modify only if rendered defects are found: `src/index.css`

- [x] **Step 1: Add the changelog fragment**

Record issue `#697`, the autosave/cancel/keyboard/add/Undo behavior, the replaced blur-only workflow, and the constraint that canonical generated analysis remains source-backed and unchanged.

- [x] **Step 2: Run static and focused verification**

Run:

```bash
pnpm exec biome check src/components/features/MeetingNotesDocument.tsx tests/unit/MeetingNotesDocument.dom.test.tsx
pnpm exec tsc --noEmit
pnpm vitest tests/unit/MeetingNotesDocument.dom.test.tsx tests/unit/meetingNotesDocument.test.ts tests/unit/meetingNotesEditRebase.test.ts --run --reporter=dot
pnpm run changelog:check
git diff --check
```

Expected: every command exits zero.

- [x] **Step 3: Inspect the rendered editor and run one critique/fix pass**

Open the Meeting Notes preview or active Electron surface at narrow and wide widths. Exercise default preview, keyboard edit entry, dirty/saving/error, add-item focus, delete/Undo, light theme, and dark theme. Fix any clipping, layout shift, invisible focus, noisy controls, or preview/editor typography mismatch, then repeat the affected inspection.

- [x] **Step 4: Review final scope and repository state**

Confirm the diff contains only issue `#697`, the earlier Backspace regression, its plan/changelog artifacts, and the user’s pre-existing `src/index.css` plus `tests/unit/zenAskPlutoDockStyles.test.ts` edits. Do not stage, reset, overwrite, or claim ownership of unrelated changes.
