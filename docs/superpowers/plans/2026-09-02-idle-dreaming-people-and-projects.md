# Idle Memory Dreaming for People and Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an idle background dreaming engine in Pluto that enriches People and Project pages from structured meeting notes without consuming battery, generating fan noise, or interrupting active usage.

**Architecture:** An Electron `IdleDreamingCoordinator` polls eligibility (`powerMonitor` idle >= 5m, AC power, thermal nominal, `knowledgeSynthesisPause` clear). When eligible, it extracts notes-first packages (`enhanced_notes`, never `transcript_json`) for one dirty entity at a time, queries local Ollama with an `AbortSignal`, deterministically validates the output, and applies additive dossier/milestone updates with 1-click user correction capability. Any user activity triggers an instant (<50ms) abort.

**Tech Stack:** TypeScript, Node.js, Electron (`powerMonitor`, `ipcMain`), Better-SQLite3, React, Vitest.

---

## File Structure Map

```
electron/
  dreaming/
    types.ts                           # Data contracts for dreaming output, packages, corrections
    idleDreamingCoordinator.ts         # Idle scheduler, eligibility policy, manual trigger API, instant abort
    packageEntityNotes.ts              # Notes-first extraction (enhanced_notes only, constraints)
    validateDreamingOutput.ts          # Deterministic schema & evidence validation, negative constraint pruning
    reconcileDreamingOutput.ts         # Transactional SQLite update for milestones, dossiers & alias suggestions
  db.ts                                # SQLite tables (entity_corrections, entity_alias_suggestions) & queries
  main.ts                              # Coordinator lifecycle, TRIGGER_DREAMING_NOW IPC handler, activity listeners
src/
  api/
    knowledgeGraph.ts                  # IPC bridges for corrections, alias actions, triggerDreamingNow
  components/
    features/projects/
      ProjectsOverview.tsx             # Zero-wait loading, remove eager on-mount discovery
      ProjectDossier.tsx               # Additive milestones, "Remove from project" action, alias banner, manual dream button
      ProjectMilestones.tsx            # Milestones display with provenance & correction menu
    KnowledgeGraph/
      PeopleTab.tsx                    # Pre-compiled briefing, "Report inaccurate" action, alias banner, manual dream button
tests/
  unit/
    entityCorrections.test.ts          # DB tests for recording and querying corrections
    packageEntityNotes.test.ts         # Verifies notes-first extraction & negative constraints
    validateDreamingOutput.test.ts     # Schema validation, source citation check, constraint filtering
    idleDreamingCoordinator.test.ts    # Idle gating, manual trigger bypass, instant preemption (<50ms), queue progression
    reconcileDreamingOutput.test.ts    # Atomic updates to milestones, dossier, and alias tables
    ProjectDossier.test.tsx            # UI tests for milestone provenance, removal, alias cards, and manual dream trigger
```

---

### Task 1: Entity Corrections Schema & Persistence

**Files:**
- Modify: `electron/db.ts`
- Create: `tests/unit/entityCorrections.test.ts`
- Modify: `src/api/knowledgeGraph.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Write the failing DB test for entity corrections**

```typescript
// tests/unit/entityCorrections.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { recordEntityCorrection, getEntityCorrections, isItemDismissed } from '../../electron/db';

describe('Entity Corrections Persistence', () => {
  it('records and checks dismissed items', () => {
    recordEntityCorrection({
      entityId: 'proj-1',
      itemType: 'milestone',
      fingerprint: 'stripe-checkout-v1',
      reason: 'inaccurate'
    });

    expect(isItemDismissed('proj-1', 'milestone', 'stripe-checkout-v1')).toBe(true);
    expect(isItemDismissed('proj-1', 'milestone', 'other-item')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
pnpm exec vitest run tests/unit/entityCorrections.test.ts
```

- [ ] **Step 3: Implement `entity_corrections` table and helper methods in `electron/db.ts`**
  - Add table `entity_corrections (id, entity_id, item_type, fingerprint, reason, created_at)`.
  - Implement `recordEntityCorrection`, `getEntityCorrections`, `isItemDismissed`.
  - Expose IPC channel `RECORD_ENTITY_CORRECTION` in `electron/main.ts`.
  - Expose API wrapper in `src/api/knowledgeGraph.ts`.

- [ ] **Step 4: Run test to verify it passes**
```bash
pnpm exec vitest run tests/unit/entityCorrections.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add electron/db.ts electron/main.ts src/api/knowledgeGraph.ts tests/unit/entityCorrections.test.ts
git commit -m "feat(dreaming): add entity_corrections table and persistence helpers (#586)"
```

---

### Task 2: Notes-First Data Packaging & Constraint Filtering

**Files:**
- Create: `electron/dreaming/types.ts`
- Create: `electron/dreaming/packageEntityNotes.ts`
- Create: `tests/unit/packageEntityNotes.test.ts`

- [ ] **Step 1: Define types in `electron/dreaming/types.ts`**
  - Define `DreamingInputPackage`, `ProjectDreamingOutput`, `PersonDreamingOutput`, `EntityCorrectionRecord`.

- [ ] **Step 2: Write failing test in `tests/unit/packageEntityNotes.test.ts`**
  - Test that only `enhanced_notes` sections are extracted, never `transcript_json`.
  - Test that existing corrections from `entity_corrections` are included as negative constraints.
  - Test that total word count remains compact (<2,000 tokens).

- [ ] **Step 3: Implement `packageEntityNotes.ts`**
  - Query meetings for entity.
  - Extract structured notes.
  - Load active corrections.
  - Build prompt payload.

- [ ] **Step 4: Run test to verify it passes**
```bash
pnpm exec vitest run tests/unit/packageEntityNotes.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add electron/dreaming/types.ts electron/dreaming/packageEntityNotes.ts tests/unit/packageEntityNotes.test.ts
git commit -m "feat(dreaming): add notes-first entity packager with negative constraints (#586)"
```

---

### Task 3: Deterministic Synthesis Validator & Filter

**Files:**
- Create: `electron/dreaming/validateDreamingOutput.ts`
- Create: `tests/unit/validateDreamingOutput.test.ts`

- [ ] **Step 1: Write failing test in `tests/unit/validateDreamingOutput.test.ts`**
  - Test validation of valid Project and Person schemas.
  - Test rejection of items referencing non-existent `source_meeting_id`.
  - Test automatic stripping of items matching negative constraints (`entity_corrections`).

- [ ] **Step 2: Implement `validateDreamingOutput.ts`**
  - Parse JSON with error fallback.
  - Validate fields and meeting citations against supplied input package.
  - Filter out dismissed fingerprints.

- [ ] **Step 3: Run test to verify it passes**
```bash
pnpm exec vitest run tests/unit/validateDreamingOutput.test.ts
```

- [ ] **Step 4: Commit**
```bash
git add electron/dreaming/validateDreamingOutput.ts tests/unit/validateDreamingOutput.test.ts
git commit -m "feat(dreaming): add deterministic output validator and constraint filter (#586)"
```

---

### Task 4: Idle Dreaming Coordinator with Instant Preemption

**Files:**
- Create: `electron/dreaming/idleDreamingCoordinator.ts`
- Create: `tests/unit/idleDreamingCoordinator.test.ts`

- [ ] **Step 1: Write failing test in `tests/unit/idleDreamingCoordinator.test.ts`**
  - Test that coordinator does not run when `onBattery` is true or idle < 300s during automatic scheduling.
  - Test `triggerNow({ entityId?: string, force?: boolean })` bypasses idle/battery check to execute immediate test runs.
  - Test that coordinator does not run when `knowledgeSynthesisPause` is locked (`capture`, `transcription`, `downstream`, `ask_pluto_session`).
  - Test that coordinator aborts in-flight request within 50ms upon `notifyForegroundActivity()` or pause lock acquisition.
  - Test that aborted entity remains dirty in queue.

- [ ] **Step 2: Implement `createIdleDreamingCoordinator` in `idleDreamingCoordinator.ts`**
  - Check policy (`powerMonitor.getSystemIdleTime()`, `isOnBatteryPower()`, `getCurrentThermalState()`, `knowledgeSynthesisPause.snapshot()`).
  - Single-entity dequeuing with 3-minute generation timeout.
  - Expose `triggerNow({ entityId?: string, force?: boolean })` for manual triggering during testing.
  - `AbortController` cancellation on foreground notification or lock acquisition.
  - Safe error catching (AbortError leaves DB untouched).

- [ ] **Step 3: Run test to verify it passes**
```bash
pnpm exec vitest run tests/unit/idleDreamingCoordinator.test.ts
```

- [ ] **Step 4: Commit**
```bash
git add electron/dreaming/idleDreamingCoordinator.ts tests/unit/idleDreamingCoordinator.test.ts
git commit -m "feat(dreaming): add idle dreaming coordinator with instant preemption (#586)"
```

---

### Task 5: Transactional Reconciler & Alias Suggestions

**Files:**
- Create: `electron/dreaming/reconcileDreamingOutput.ts`
- Create: `tests/unit/reconcileDreamingOutput.test.ts`
- Modify: `electron/db.ts`

- [ ] **Step 1: Write failing test in `tests/unit/reconcileDreamingOutput.test.ts`**
  - Test atomic write of milestones and updated summary to SQLite.
  - Test staging of `suggested_aliases` without destroying existing identities.
  - Test updating dirty entity status to clean.

- [ ] **Step 2: Implement `reconcileDreamingOutput.ts` and DB queries in `electron/db.ts`**
  - Add `entity_alias_suggestions` table.
  - Implement atomic commit inside a SQLite transaction.

- [ ] **Step 3: Run test to verify it passes**
```bash
pnpm exec vitest run tests/unit/reconcileDreamingOutput.test.ts
```

- [ ] **Step 4: Commit**
```bash
git add electron/dreaming/reconcileDreamingOutput.ts tests/unit/reconcileDreamingOutput.test.ts electron/db.ts
git commit -m "feat(dreaming): add transactional reconciler and alias suggestion store (#586)"
```

---

### Task 6: Project Dossier UI & "Remove / Report Inaccurate" Action

**Files:**
- Modify: `src/components/features/projects/ProjectsOverview.tsx`
- Modify: `src/components/features/projects/ProjectDossier.tsx`
- Modify: `src/components/features/projects/ProjectMilestones.tsx`
- Modify: `tests/unit/ProjectDossier.test.tsx`

- [ ] **Step 1: Write failing UI test in `tests/unit/ProjectDossier.test.tsx`**
  - Test rendering of milestone meeting provenance links.
  - Test clicking "Remove from project" calls `recordEntityCorrection` and removes milestone from view.
  - Test rendering alias suggestion banner with `[Merge]` and `[Keep Separate]` buttons.

- [ ] **Step 2: Implement UI changes**
  - In `ProjectsOverview.tsx`: Remove blocking on-mount synthesis, load pre-compiled data.
  - In `ProjectMilestones.tsx`: Add subtle hover action with "Remove from project".
  - In `ProjectDossier.tsx`: Add alias suggestion card header with merge / dismiss handlers.

- [ ] **Step 3: Run test to verify it passes**
```bash
pnpm exec vitest run tests/unit/ProjectDossier.test.tsx
```

- [ ] **Step 4: Commit**
```bash
git add src/components/features/projects/ tests/unit/ProjectDossier.test.tsx
git commit -m "feat(projects): add frictionless milestones, remove action, and alias suggestions (#586)"
```

---

### Task 7: People Tab UI & Correction Actions

**Files:**
- Modify: `src/components/KnowledgeGraph/PeopleTab.tsx`
- Modify: `tests/unit/PeopleTab.test.tsx`

- [ ] **Step 1: Write failing UI test in `tests/unit/PeopleTab.test.tsx`**
  - Test rendering of pre-compiled briefing points and "Report inaccurate" button.
  - Test alias suggestion banner for people.

- [ ] **Step 2: Implement UI changes in `PeopleTab.tsx`**
  - Add correction action to briefing bullet points.
  - Add alias suggestion pill at the top of person detail.

- [ ] **Step 3: Run test to verify it passes**
```bash
pnpm exec vitest run tests/unit/PeopleTab.test.tsx
```

- [ ] **Step 4: Commit**
```bash
git add src/components/KnowledgeGraph/PeopleTab.tsx tests/unit/PeopleTab.test.tsx
git commit -m "feat(people): add inline corrections and alias suggestions to people tab (#586)"
```

---

### Task 8: Wire Coordinator in Electron Main & Full Verification

**Files:**
- Modify: `electron/main.ts`
- Create: `docs/changelog/entries/2026-09-02-586-idle-dreaming-people-and-projects.md`
- Modify: `docs/decisions.md`

- [ ] **Step 1: Wire `createIdleDreamingCoordinator` in `electron/main.ts`**
  - Start coordinator when app is ready.
  - Wire `powerMonitor.on('user-did-become-active')` to notify coordinator.
  - Hook IPC channels.

- [ ] **Step 2: Add durable decision in `docs/decisions.md` and changelog entry**

- [ ] **Step 3: Run full test suite & linter**
```bash
pnpm test
pnpm run lint
pnpm run changelog:check
```

- [ ] **Step 4: Final commit**
```bash
git add electron/main.ts docs/decisions.md docs/changelog/entries/
git commit -m "feat(dreaming): wire idle dreaming coordinator in main process (#586)"
```
