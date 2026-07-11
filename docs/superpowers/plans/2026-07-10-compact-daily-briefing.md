# Compact Daily Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** #59

**Goal:** Increase homepage information yield with a compact briefing header, denser work queue, supporting context column, and recent-memory list.

**Architecture:** Preserve `dashboardModel.ts` as the source of truth for priority and real-data decisions. Extract only presentational components; do not add a parallel urgency system. Reuse the workspace density primitives proven by #357.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest

---

## File map

- Create `src/components/features/DashboardBriefingHeader.tsx`: compact headline and actions.
- Create `src/components/features/DashboardWorkQueue.tsx`: five-to-seven action rows.
- Create `src/components/features/DashboardContextPanel.tsx`: latest meeting, recording, and spotlight.
- Create `src/components/features/DashboardMemoryList.tsx`: four-to-six knowledge rows.
- Modify `src/components/features/Dashboard.tsx`: composition and responsive grid.
- Modify `src/App.tsx`: reduce homepage-only outer gutters.
- Modify `tests/unit/Dashboard.test.tsx`: semantic and state coverage.
- Modify `docs/CHANGELOG.md` and `docs/decisions.md`: durable outcome and decision.

### Task 1: Lock the compact hierarchy with failing tests

**Files:**
- Modify: `tests/unit/Dashboard.test.tsx`

- [ ] **Step 1: Add populated-state assertions**

Build a model containing seven visible actions and six documents. Render `Dashboard` and assert landmarks named “Daily briefing,” “Focus now,” “Latest meeting,” and “Recent memory”; seven work-queue rows; up to six memory rows; and one primary briefing action. Add stable `data-testid="dashboard-action-row"` and `data-testid="dashboard-memory-row"` only where semantic role counts would be ambiguous.

- [ ] **Step 2: Add loading, empty, degraded, and recording assertions**

Assert localized state copy while healthy sections remain rendered. Confirm recording context appears in the supporting panel and does not replace the briefing.

- [ ] **Step 3: Run the focused test**

Run: `../../node_modules/.bin/vitest run tests/unit/Dashboard.test.tsx --run`

Expected: FAIL against the current three-action/three-document card layout.

- [ ] **Step 4: Commit the red tests**

```bash
git add tests/unit/Dashboard.test.tsx
git commit -m "test: define compact homepage hierarchy"
```

### Task 2: Extract the compact briefing header

**Files:**
- Create: `src/components/features/DashboardBriefingHeader.tsx`
- Modify: `src/components/features/Dashboard.tsx`

- [ ] **Step 1: Define a focused prop contract**

```ts
type DashboardBriefingHeaderProps = {
  hero: DashboardHomeModel['hero'];
  loading: boolean;
  primaryAction: DashboardAction;
  secondaryActions: DashboardAction[];
  onAction: (action: DashboardAction) => void;
};
```

Render a shallow `header` with one `h1`, concise detail, one primary action, and no more than two secondary actions. Move `getHeroTone` and `getHeroLabel` with the presentation; preserve their mappings exactly.

- [ ] **Step 2: Apply compact sizing**

Use 20–24 px padding, 12–16 px gaps/radius, sentence-case labels, and a clamped headline. Preserve action identity filtering.

- [ ] **Step 3: Run tests and commit**

```bash
../../node_modules/.bin/vitest run tests/unit/Dashboard.test.tsx --run
git add src/components/features/DashboardBriefingHeader.tsx src/components/features/Dashboard.tsx
git commit -m "feat: compact the daily briefing header"
```

Expected: header assertions pass; queue/memory assertions remain red.

### Task 3: Replace action cards with a work queue

**Files:**
- Create: `src/components/features/DashboardWorkQueue.tsx`
- Modify: `src/components/features/Dashboard.tsx`
- Modify: `tests/unit/Dashboard.test.tsx`

- [ ] **Step 1: Render model-ranked actions**

Use `model.actionInsights.items.slice(0, 7)` without re-sorting. Each row exposes title, due label, source label, blocker/status text, and completion control. Use dividers and one shared surface rather than elevated cards.

- [ ] **Step 2: Preserve interaction states**

Keep `aria-busy`, disabled state, loading spinner, visible focus, action error, and “See N more in projects.” Keep blocker reason visible and never color-only.

- [ ] **Step 3: Run regression tests**

```bash
../../node_modules/.bin/vitest run tests/unit/Dashboard.test.tsx tests/unit/dashboardModel.test.ts tests/unit/dashboardActionCompletion.test.ts --run
```

Expected: queue, priority, trust-context, and completion tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/features/DashboardWorkQueue.tsx src/components/features/Dashboard.tsx tests/unit/Dashboard.test.tsx
git commit -m "feat: show dashboard actions as a compact work queue"
```

### Task 4: Consolidate supporting context

**Files:**
- Create: `src/components/features/DashboardContextPanel.tsx`
- Modify: `src/components/features/Dashboard.tsx`

- [ ] **Step 1: Build one supporting panel**

Render latest meeting first, compact recording status when active, then the evidence-backed project spotlight when present. Reuse current actions and omit unsupported regions. Do not wrap each item in a nested card.

- [ ] **Step 2: Define responsive order**

Use `grid-template-columns: minmax(0, 1.45fr) minmax(280px, .8fr)` at wide sizes. At narrow widths preserve briefing, queue, context, then memory in document order.

- [ ] **Step 3: Run tests and commit**

```bash
../../node_modules/.bin/vitest run tests/unit/Dashboard.test.tsx --run
git add src/components/features/DashboardContextPanel.tsx src/components/features/Dashboard.tsx
git commit -m "feat: consolidate dashboard supporting context"
```

### Task 5: Replace knowledge cards with a recent-memory list

**Files:**
- Create: `src/components/features/DashboardMemoryList.tsx`
- Modify: `src/components/features/Dashboard.tsx`
- Modify: `tests/unit/Dashboard.test.tsx`

- [ ] **Step 1: Render up to six existing items as rows**

Show scope icon, title, one-line description, trust/freshness from `getTrustStatusMeta`, and open action. Omit project/person metadata when the model does not provide it; never infer associations.

- [ ] **Step 2: Implement localized loading and empty states**

Retain section geometry. Use compact skeleton rows while loading and one concise, action-oriented empty row when no sources exist.

- [ ] **Step 3: Run tests and commit**

```bash
../../node_modules/.bin/vitest run tests/unit/Dashboard.test.tsx tests/unit/dashboardModel.test.ts --run
git add src/components/features/DashboardMemoryList.tsx src/components/features/Dashboard.tsx tests/unit/Dashboard.test.tsx
git commit -m "feat: show recent memory as a compact list"
```

### Task 6: Tighten homepage gutters and verify the complete design

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/features/Dashboard.tsx`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/decisions.md`

- [ ] **Step 1: Reduce homepage-only outer spacing**

Change only the hub branch in `App.tsx` from `md:px-12 lg:px-20 py-6 md:py-10` to the proven 20–24 px workspace gutter. Do not affect Meeting, Knowledge, People, or Projects.

- [ ] **Step 2: Run focused and broad checks**

```bash
../../node_modules/.bin/vitest run tests/unit/Dashboard.test.tsx tests/unit/dashboardModel.test.ts tests/unit/dashboardActionCompletion.test.ts --run
../../node_modules/.bin/tsc --noEmit --pretty false
../../node_modules/.bin/biome check src/App.tsx src/components/features/Dashboard*.tsx
```

Expected: focused tests and checks pass; model priority remains unchanged.

- [ ] **Step 3: Perform design QA**

Verify narrow/wide Electron windows, light/dark themes, keyboard completion/navigation, long titles, seven actions, six documents, empty/loading/degraded states, active recording, and reduced motion. Confirm the initial wide viewport shows the full briefing, at least four action rows, and most of latest meeting. Score all six UX dimensions; no dimension may ship below 7/10 and accessibility/usability must reach 8/10.

- [ ] **Step 4: Record the outcome and commit**

Update the changelog with why the homepage is more useful, add the fewer-containers decision to `docs/decisions.md`, and comment verification evidence on #59.

```bash
git add src/App.tsx src/components/features/Dashboard.tsx docs/CHANGELOG.md docs/decisions.md
git commit -m "feat: make the daily briefing more information dense"
```
