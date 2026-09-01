# Tabbed Settings Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overwhelming single-stack Settings page with four accessible horizontal category tabs while preserving every existing control and behavior.

**Architecture:** Keep tab state and composition inside `SettingsTab`, where the existing sections already converge. Reuse `IdentitySettings` and `CalendarSettings` unchanged, move the existing Appearance, Recording, Analysis, and Advanced markup into intent-based tab panels, and add focused DOM tests around observable navigation behavior.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest, happy-dom.

---

## File map

- Create `tests/unit/SettingsTab.dom.test.tsx`: render the complete Settings surface with child setup flows mocked, then verify tab semantics, visibility, clicking, and keyboard navigation.
- Modify `src/components/features/SettingsTab.tsx`: define the four-tab model, implement roving keyboard focus, and compose existing controls into the selected panel.
- Create `docs/changelog/entries/2026-08-31-tabbed-settings-layout.md`: record the shipped user-facing improvement and its cognitive-load rationale.
- Retain `src/components/features/IdentitySettings.tsx` and `src/components/features/CalendarSettings.tsx` without behavioral edits.

### Task 1: Specify the tab interaction contract

**Files:**
- Create: `tests/unit/SettingsTab.dom.test.tsx`
- Test: `tests/unit/SettingsTab.dom.test.tsx`

- [ ] **Step 1: Add a Settings render harness**

Mock the two rich child flows so tests stay focused on Settings information architecture, provide `window.ipcRenderer.invoke`, and render `SettingsTab` with stable defaults:

```tsx
vi.mock('../../src/components/features/IdentitySettings', () => ({
  IdentitySettings: () => <div>Identity settings content</div>,
}));

vi.mock('../../src/components/features/CalendarSettings', () => ({
  CalendarSettings: () => <div>Calendar settings content</div>,
}));

const defaultProps = {
  llmProvider: 'ollama' as const,
  setLlmProvider: vi.fn(),
  geminiApiKey: '',
  setGeminiApiKey: vi.fn(),
  openaiApiKey: '',
  setOpenaiApiKey: vi.fn(),
  claudeApiKey: '',
  setClaudeApiKey: vi.fn(),
  ollamaModel: '',
  setOllamaModel: vi.fn(),
  autoEndEnabled: true,
  setAutoEndEnabled: vi.fn(),
  fetchMeetings: vi.fn(),
  setSelectedMeetingId: vi.fn(),
  theme: 'system' as const,
  setTheme: vi.fn(),
};
```

- [ ] **Step 2: Write failing semantic and visibility tests**

Assert that the tablist exposes exactly Personal, Meetings, Intelligence, and Advanced; Personal is selected by default; only Personal content is rendered; and clicking Meetings replaces it with Calendar and Recording content.

```tsx
expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
  'Settings categories',
);
expect(tabs.map((tab) => tab.textContent)).toEqual([
  'Personal',
  'Meetings',
  'Intelligence',
  'Advanced',
]);
expect(tabs[0].getAttribute('aria-selected')).toBe('true');
expect(container.textContent).toContain('Identity settings content');
expect(container.textContent).not.toContain('Calendar settings content');
```

- [ ] **Step 3: Write failing keyboard tests**

Focus Personal, dispatch ArrowRight, End, Home, and ArrowLeft events, then assert selection, `tabIndex`, focus, and active panel content follow the WAI-ARIA tab pattern.

```tsx
act(() => {
  tabs[0].focus();
  tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
});
expect(document.activeElement).toBe(tabs[1]);
expect(tabs[1].getAttribute('aria-selected')).toBe('true');
```

- [ ] **Step 4: Run the new test and verify RED**

Run: `pnpm vitest run tests/unit/SettingsTab.dom.test.tsx`

Expected: FAIL because `SettingsTab` does not render a tablist and all six existing sections remain visible.

- [ ] **Step 5: Commit the failing contract**

```bash
git add tests/unit/SettingsTab.dom.test.tsx
git commit -m "test: specify tabbed settings navigation (#643)"
```

### Task 2: Implement progressive disclosure in Settings

**Files:**
- Modify: `src/components/features/SettingsTab.tsx`
- Test: `tests/unit/SettingsTab.dom.test.tsx`

- [ ] **Step 1: Define the local tab model and state**

Add a narrow local union and ordered labels, then initialize Personal as the active tab:

```tsx
const settingsTabs = [
  { id: 'personal', label: 'Personal' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'advanced', label: 'Advanced' },
] as const;

type SettingsTabId = (typeof settingsTabs)[number]['id'];

const [activeSettingsTab, setActiveSettingsTab] =
  useState<SettingsTabId>('personal');
```

- [ ] **Step 2: Add accessible horizontal tab navigation**

Render one button per tab with paired IDs, `aria-controls`, `aria-selected`, roving `tabIndex`, visible focus, and restrained selected styling. Handle ArrowLeft, ArrowRight, Home, and End by selecting and focusing the destination tab.

```tsx
const selectAndFocusTab = (index: number) => {
  const next = settingsTabs[index];
  setActiveSettingsTab(next.id);
  requestAnimationFrame(() => {
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  });
};
```

- [ ] **Step 3: Recompose existing sections into four panels**

Render one `role="tabpanel"` branch at a time:

```tsx
{activeSettingsTab === 'personal' ? (
  <div role="tabpanel" id="settings-panel-personal" aria-labelledby="settings-tab-personal">
    <IdentitySettings />
    {appearanceSection}
  </div>
) : null}
```

Move Calendar plus Recording under Meetings, provider and model controls under Intelligence, and reset under Advanced. Keep all callbacks, persistence keys, busy states, confirmation copy, and provider-conditional behavior intact.

- [ ] **Step 4: Refine density without broad component churn**

Keep rich Identity and Calendar setup containers. For simple sections, reduce repeated outer shadow/card weight, use consistent divided rows, and keep the current responsive stacked row behavior. Make the tab strip horizontally scrollable without giving it a separate background or allowing it to float over Settings content.

- [ ] **Step 5: Run the focused tab test and verify GREEN**

Run: `pnpm vitest run tests/unit/SettingsTab.dom.test.tsx`

Expected: PASS with all tab behavior assertions green and no React warnings.

- [ ] **Step 6: Run adjacent Settings tests**

Run: `pnpm vitest run tests/unit/SettingsTab.dom.test.tsx tests/unit/CalendarSettings.dom.test.tsx tests/unit/IdentityProfile.dom.test.tsx tests/unit/askPlutoModelSettingsSurface.test.ts tests/unit/transcriptionSettingsSurface.test.ts`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit the implementation**

```bash
git add src/components/features/SettingsTab.tsx tests/unit/SettingsTab.dom.test.tsx
git commit -m "feat: organize settings into focused tabs (#643)"
```

### Task 3: Record and verify the shipped outcome

**Files:**
- Create: `docs/changelog/entries/2026-08-31-tabbed-settings-layout.md`
- Modify only if verification exposes an issue: `src/components/features/SettingsTab.tsx`, `tests/unit/SettingsTab.dom.test.tsx`

- [ ] **Step 1: Add the changelog fragment**

```markdown
---
category: Changed
issue: 643
---

Settings now groups personal, meeting, intelligence, and advanced controls into focused tabs, reducing visual overload without hiding or changing existing preferences.
```

- [ ] **Step 2: Run static verification**

Run: `pnpm exec tsc --noEmit`

Expected: exit 0.

Run: `pnpm exec biome check src/components/features/SettingsTab.tsx tests/unit/SettingsTab.dom.test.tsx docs/changelog/entries/2026-08-31-tabbed-settings-layout.md`

Expected: exit 0.

Run: `pnpm run changelog:check && git diff --check`

Expected: both commands exit 0.

- [ ] **Step 3: Run the complete unit suite**

Run: `pnpm vitest run`

Expected: all test files pass with zero failures.

- [ ] **Step 4: Inspect the rendered UI**

Run Pluto from this worktree, open Settings, and inspect a typical desktop width plus the narrowest supported app window. Verify one focused panel, clear selected state, no clipped tab labels or controls, visible keyboard focus, retained Calendar and Identity states, and restrained visual hierarchy.

- [ ] **Step 5: Commit the release record and any verified refinements**

```bash
git add docs/changelog/entries/2026-08-31-tabbed-settings-layout.md src/components/features/SettingsTab.tsx tests/unit/SettingsTab.dom.test.tsx
git commit -m "docs: record focused settings navigation (#643)"
```
