# Project Detail Milestones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Pluto's project detail into a lighter evidence-grounded briefing with persisted user milestones and modest, truthful analytics.

**Architecture:** Persist user milestones as a versioned array inside the canonical project entity's existing metadata so the feature requires no schema migration and survives restarts. Keep mutation logic atomic in the Electron database layer, expose narrow IPC methods, and merge user milestones with read-only commitment-derived milestones in the existing project brief. Extract the interactive milestone surface into a focused React component while leaving project identity, merge history, commitments, and source evidence intact.

**Tech Stack:** React 18, TypeScript, Electron IPC, better-sqlite3, Tailwind CSS, Lucide, Vitest, happy-dom.

---

### Task 1: Versioned milestone metadata

**Files:**
- Create: `src/utils/projectMilestones.ts`
- Create: `tests/unit/projectMilestones.test.ts`

- [ ] **Step 1: Write failing tests for parsing and mutation**

Cover malformed metadata, invalid records, title trimming, optional date/note normalization, preservation of unrelated metadata, stable creation timestamps on edits, and recoverable deletion. The desired public contract is:

```ts
export type UserProjectMilestoneStatus = 'planned' | 'in_progress' | 'completed';
export interface UserProjectMilestone {
  id: string;
  title: string;
  status: UserProjectMilestoneStatus;
  targetDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
export const readUserProjectMilestones = (metadata: string | null): UserProjectMilestone[];
export const withSavedUserProjectMilestone = (
  metadata: string | null,
  input: { id?: string; title: string; status: UserProjectMilestoneStatus; targetDate?: string | null; note?: string | null },
  options: { id: string; now: string },
): { metadata: string; milestone: UserProjectMilestone };
export const withoutUserProjectMilestone = (
  metadata: string | null,
  milestoneId: string,
): { metadata: string; removed: UserProjectMilestone | null };
```

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run tests/unit/projectMilestones.test.ts`. Expected: failure because `src/utils/projectMilestones.ts` does not exist.

- [ ] **Step 3: Implement the minimal metadata helpers**

Store valid records under `projectMilestones` and write `projectMilestonesVersion: 1`. Throw `project_milestone_title_required` for a blank title and `project_milestone_not_found` when an edit id does not exist. Preserve all unrelated metadata properties.

- [ ] **Step 4: Verify GREEN**

Run `pnpm exec vitest run tests/unit/projectMilestones.test.ts`. Expected: all tests pass.

### Task 2: Atomic database and IPC lifecycle

**Files:**
- Modify: `electron/db.ts`
- Modify: `electron/main.ts`
- Modify: `src/api/knowledgeGraph.ts`
- Modify: `tests/unit/projectPortfolioDb.test.ts`

- [ ] **Step 1: Write failing database lifecycle tests**

Create a project, save a milestone, edit it, confirm unrelated qualification metadata remains, retrieve it through `getProjectBrief`, delete it, and restore it with the original id. Also verify mutations against a merged alias resolve to the canonical project.

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run tests/unit/projectPortfolioDb.test.ts`. Expected: failure because milestone database functions do not exist.

- [ ] **Step 3: Add database mutations and IPC wrappers**

Add this database contract:

```ts
export const saveProjectMilestone = (
  projectId: string,
  input: { id?: string; title: string; status: UserProjectMilestoneStatus; targetDate?: string | null; note?: string | null },
): UserProjectMilestone;
export const deleteProjectMilestone = (
  projectId: string,
  milestoneId: string,
): UserProjectMilestone;
```

Resolve aliases first, reject non-project ids, read the latest metadata inside a database transaction, and update only metadata plus `updated_at`. Register `SAVE_PROJECT_MILESTONE` and `DELETE_PROJECT_MILESTONE` handlers. Add typed renderer wrappers with the same names in camel case.

- [ ] **Step 4: Verify GREEN**

Run `pnpm exec vitest run tests/unit/projectPortfolioDb.test.ts tests/unit/projectMilestones.test.ts`. Expected: all tests pass.

### Task 3: Grounded briefing analytics and provenance

**Files:**
- Modify: `src/utils/projectBriefing.ts`
- Modify: `electron/db.ts`
- Modify: `tests/unit/projectBriefing.test.ts`
- Modify: `tests/unit/projectPortfolioDb.test.ts`

- [ ] **Step 1: Write failing briefing tests**

Require commitment-derived milestones to report `source: 'commitment'`, user milestones to report `source: 'user'`, raw target dates to survive for editing, and milestone ordering to put overdue and active work before completed work. Require momentum to expose `recentMeetingCount`, `openCommitmentCount`, `completedCommitmentCount`, `recentlyCompletedCount`, `lastActivityAt`, and an evidence-limited headline that never claims improvement from missing data.

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run tests/unit/projectBriefing.test.ts tests/unit/projectPortfolioDb.test.ts`. Expected: failures for missing provenance and momentum fields.

- [ ] **Step 3: Implement the brief additions**

Extend `ProjectMilestone` with `source`, `targetDate`, and `note`. Add `buildUserProjectMilestones(metadata, now)` and `buildProjectMomentum(meetings, tasks, now)`. Merge the two milestone sources in `getProjectBrief` without changing the existing health contract.

- [ ] **Step 4: Verify GREEN**

Run `pnpm exec vitest run tests/unit/projectBriefing.test.ts tests/unit/projectPortfolioDb.test.ts`. Expected: all tests pass.

### Task 4: Lighter editorial project detail

**Files:**
- Create: `src/components/features/projects/ProjectMilestones.tsx`
- Modify: `src/components/features/projects/ProjectDossier.tsx`
- Modify: `tests/unit/ProjectDossier.test.tsx`

- [ ] **Step 1: Write failing component tests**

Require the page to render `What needs attention`, `Health`, `Milestones`, and `Momentum`; require user and meeting provenance labels; submit the inline add form; edit and complete a user milestone; reject edit controls for commitment-derived milestones; retain the draft on mutation failure; and delete with an Undo action that restores the original id.

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run tests/unit/ProjectDossier.test.tsx`. Expected: failures for the new hierarchy and interactions.

- [ ] **Step 3: Build the milestone component**

Use semantic headings and list markup. The inline form has visible labels for title, target date, status, and note. Status is never color-only. User milestones expose edit, complete, and delete controls; commitment-derived milestones expose evidence only. Keep mutation errors local and announce success with `output` or `role=status`.

- [ ] **Step 4: Reshape the dossier**

Increase the readable width modestly, use an asymmetric opening grid at wide widths, keep only attention, health, and momentum as tinted/bordered modules, render milestones as a vertical path, and move meeting rhythm, related work, source meetings, identity, and merge controls into light disclosure sections. At narrow widths the grid becomes one column and milestone rows stack without horizontal scrolling.

- [ ] **Step 5: Verify GREEN**

Run `pnpm exec vitest run tests/unit/ProjectDossier.test.tsx tests/unit/projectBriefing.test.ts tests/unit/projectPortfolioDb.test.ts tests/unit/projectMilestones.test.ts`. Expected: all tests pass.

### Task 5: Durable product record

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-08-29-project-detail-milestones.md`

- [ ] **Step 1: Record the decision**

Document that user milestones are versioned project metadata, remain distinct from evidence-derived commitments, and use explicit provenance in the UI. Record that project analytics only summarize observed meetings and commitments and do not generate composite progress scores.

- [ ] **Step 2: Add the changelog fragment**

Describe why the project detail changed: faster re-entry, calmer hierarchy, truthful analytics, and user-controlled milestones.

- [ ] **Step 3: Validate changelog structure**

Run `pnpm run changelog:check`. Expected: exit 0.

### Task 6: Verification and rendered critique

**Files:**
- Modify only files already in scope when visual inspection reveals defects.

- [ ] **Step 1: Run static and automated verification**

Run focused Vitest, `pnpm exec tsc --noEmit`, focused Biome checks, `git diff --check`, `pnpm run changelog:check`, and `pnpm run build`.

- [ ] **Step 2: Restore Electron's SQLite ABI**

Run `pnpm run ensure:sqlite-abi` before launching the app.

- [ ] **Step 3: Inspect rendered UI**

Open the project detail in Electron and inspect wide desktop, small laptop, and narrow window widths. Check hierarchy, wrapping, focus visibility, the add/edit flow, empty milestones, stale/error states, and disclosure controls.

- [ ] **Step 4: Critique and patch**

Compare the live result against the approved first probe, with the user's requested lighter treatment. Fix any material hierarchy, density, contrast, overflow, or interaction defects, then repeat the screenshots.

- [ ] **Step 5: Run final verification**

Run `pnpm run test -- --run`, TypeScript, build, Biome, changelog check, and diff check again. Review `git status` and the complete diff before committing.

### Task 7: Delivery

**Files:**
- No additional product files.

- [ ] **Step 1: Commit the verified branch**

Commit only issue #691 files with a conventional commit message referencing the outcome.

- [ ] **Step 2: Push and open a pull request**

Push `codex/691-project-detail-milestones`, create a PR that closes #691, list automated verification separately from rendered Electron evidence, and leave the worktree available for follow-up.
