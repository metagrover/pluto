# Dashboard Briefing Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard feel calmer and more helpful by turning it into a focused daily briefing.

**Architecture:** Keep the existing renderer-side dashboard data pipeline. Add a small tested `briefingFocus` model so the UI can rank the page around one primary next step, then simplify `Dashboard.tsx` presentation without permanently deleting data-backed sections.

**Tech Stack:** React, TypeScript, Vitest, Tailwind.

---

### Task 1: Add A Tested Briefing Focus

**Files:**
- Modify: `tests/unit/dashboardModel.test.ts`
- Modify: `src/components/features/dashboardModel.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving the model chooses action attention before meetings, and meetings before knowledge-only states.

- [ ] **Step 2: Run focused tests**

Run: `pnpm exec vitest run tests/unit/dashboardModel.test.ts --run`

Expected: FAIL because `briefingFocus` does not exist yet.

- [ ] **Step 3: Implement model**

Add `DashboardBriefingFocus` and `buildBriefingFocus()` using existing real model inputs only.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run tests/unit/dashboardModel.test.ts --run`

Expected: PASS.

### Task 2: Simplify Dashboard Presentation

**Files:**
- Modify: `src/components/features/Dashboard.tsx`

- [ ] **Step 1: Replace oversized section stack**

Use one compact hero, one primary briefing panel, one compact latest meeting panel, and a smaller recent knowledge panel. Keep spotlight conditionally rendered but demote it.

- [ ] **Step 2: Remove duplicate controls and decorative noise**

Remove duplicate `GO` control, large glow elements, and repeated uppercase labels that do not add information.

- [ ] **Step 3: Preserve navigation behavior**

Keep Ask Pluto, latest meeting, projects, and wiki actions wired through existing callbacks.

### Task 3: Verify

**Files:**
- No source modifications.

- [ ] **Step 1: Run focused dashboard tests**

Run: `pnpm exec vitest run tests/unit/dashboardModel.test.ts --run`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit --pretty false`

Expected: PASS.

- [ ] **Step 3: Inspect local app**

Run: `pnpm run dev` if needed and inspect `http://localhost:5173/`.

Expected: dashboard is calmer, with one clear next step and compact supporting context.
