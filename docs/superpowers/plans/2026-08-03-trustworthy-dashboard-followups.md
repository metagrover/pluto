# Trustworthy Dashboard Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dashboard completion controls available only for explicitly confirmed commitments while giving extracted candidates a truthful source-review, confirmation, and rejection flow.

**Architecture:** A shared pure metadata contract parses action commitment state fail-closed. Extraction and explicit task creation persist origin at creation time, a narrow database mutation merges review state without overwriting metadata, and the dashboard model becomes the sole authority for presentation state and allowed controls.

**Tech Stack:** TypeScript, Electron IPC, React, Vitest, SQLite through the existing database module.

---

## File map

- Create `src/utils/actionCommitment.ts`: shared metadata types, parsing, creation, and merge helpers.
- Modify `electron/entityPipeline.ts`: mark extracted actions possible and retain their meeting source.
- Modify `src/components/KnowledgeGraph/ProjectsExecutionTab.tsx`: mark quick-added tasks confirmed.
- Modify `electron/db.ts`: merge and persist a reviewed commitment state.
- Modify `electron/main.ts` and `src/api/knowledgeGraph.ts`: expose the narrow review-state IPC.
- Modify `src/components/features/dashboardActionCompletion.ts`: persist confirm/reject before refresh.
- Modify `src/components/features/dashboardModel.ts`: classify/filter actions and emit review presentation state.
- Modify `src/components/features/Dashboard.tsx` and `src/App.tsx`: render and handle review actions.
- Modify focused tests under `tests/unit/` before each production change.
- Modify `docs/decisions.md` and create `docs/changelog/entries/2026-08-03-562-trustworthy-dashboard-followups.md` for durable traceability.

### Task 1: Persist explicit origin for newly created actions

**Files:**
- Create: `src/utils/actionCommitment.ts`
- Modify: `tests/unit/relationshipInference.test.ts`
- Modify: `electron/entityPipeline.ts`
- Modify: `src/components/KnowledgeGraph/ProjectsExecutionTab.tsx`

- [ ] **Step 1: Write failing shared-contract and extraction tests**

Add a focused test file `tests/unit/actionCommitment.test.ts` that requires legacy and malformed metadata to resolve to `possible`, validates all three supported states, and proves review updates preserve `full_description` and `assignee_name`.

Add a `relationshipInference.test.ts` case that processes one extracted action and expects the `upsertEntity` input metadata to contain:

```ts
{
  full_description: 'Send the rollout note',
  assignee_name: 'Alex',
  commitment_state: 'possible',
  origin: 'extraction',
  source_meeting_id: 'meeting-action-source',
}
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/actionCommitment.test.ts tests/unit/relationshipInference.test.ts
```

Expected: fail because `actionCommitment.ts` and the persisted fields do not exist.

- [ ] **Step 3: Implement the minimal shared contract and extraction write**

Export these exact public concepts from `src/utils/actionCommitment.ts`:

```ts
export type CommitmentState = 'possible' | 'confirmed' | 'rejected';
export type ActionOrigin = 'extraction' | 'user';
export interface ActionCommitmentMetadata {
  commitment_state: CommitmentState;
  origin: ActionOrigin;
  source_meeting_id?: string;
  reviewed_at?: string;
}

export const parseActionMetadata = (value: string | null): Record<string, unknown>;
export const getCommitmentState = (value: string | null): CommitmentState;
export const mergeCommitmentReview = (
  value: string | null,
  commitmentState: Extract<CommitmentState, 'confirmed' | 'rejected'>,
  reviewedAt: string,
): Record<string, unknown>;
```

Parsing must return an empty object for invalid/non-object JSON, and `getCommitmentState` must return `possible` unless the stored value is exactly supported. Extend extracted-action metadata with possible/extraction/source fields.

- [ ] **Step 4: Mark explicit quick-add tasks confirmed**

Change the existing quick-add metadata to:

```ts
metadata: {
  full_description: value.trim(),
  commitment_state: 'confirmed',
  origin: 'user',
},
```

Keep the existing project-link behavior unchanged.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the same Vitest command and expect both files to pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/actionCommitment.ts electron/entityPipeline.ts src/components/KnowledgeGraph/ProjectsExecutionTab.tsx tests/unit/actionCommitment.test.ts tests/unit/relationshipInference.test.ts
git commit -m "feat: persist dashboard commitment origin (#562)"
```

### Task 2: Persist confirmation and rejection without overwriting metadata

**Files:**
- Modify: `electron/db.ts`
- Modify: `electron/main.ts`
- Modify: `src/api/knowledgeGraph.ts`
- Modify: `src/components/features/dashboardActionCompletion.ts`
- Modify: `tests/unit/actionCommitment.test.ts`
- Modify: `tests/unit/dashboardActionCompletion.test.ts`

- [ ] **Step 1: Write failing persistence-orchestration tests**

Extend `dashboardActionCompletion.test.ts` with `persistDashboardCommitmentReview`. Require it to call `updateActionCommitmentState(id, state)` before refreshing, and require no refresh after mutation failure for both `confirmed` and `rejected` states.

The pure metadata test must prove this input:

```ts
JSON.stringify({
  full_description: 'Send the rollout note',
  assignee_name: 'Alex',
  commitment_state: 'possible',
  origin: 'extraction',
  source_meeting_id: 'meeting-1',
})
```

retains every existing field after confirmation or rejection and adds a supplied `reviewed_at` timestamp.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run tests/unit/actionCommitment.test.ts tests/unit/dashboardActionCompletion.test.ts
```

Expected: fail because the review persistence function does not exist.

- [ ] **Step 3: Add the narrow database mutation and IPC**

Add `db.updateActionCommitmentState(id, commitmentState, reviewedAt = new Date().toISOString())`. It must:

1. Load the entity by ID.
2. Reject missing or non-action entities.
3. Merge metadata with `mergeCommitmentReview`.
4. Update only `metadata` and `updated_at` for that ID.
5. Return the updated entity.

Expose it as `UPDATE_ACTION_COMMITMENT_STATE` in `electron/main.ts` and as:

```ts
export const updateActionCommitmentState = async (
  id: string,
  commitmentState: 'confirmed' | 'rejected',
): Promise<Entity> => invoke('UPDATE_ACTION_COMMITMENT_STATE', {
  id,
  commitmentState,
});
```

Queue Knowledge refresh after a successful mutation, matching other entity mutations.

- [ ] **Step 4: Add renderer-side review persistence**

Implement `persistDashboardCommitmentReview` beside the existing completion helper. It calls the injected state mutation, then refreshes, and never refreshes on failure.

- [ ] **Step 5: Run and verify GREEN**

Run the same focused command and expect all tests to pass.

- [ ] **Step 6: Commit**

```bash
git add electron/db.ts electron/main.ts src/api/knowledgeGraph.ts src/components/features/dashboardActionCompletion.ts tests/unit/actionCommitment.test.ts tests/unit/dashboardActionCompletion.test.ts
git commit -m "feat: persist dashboard commitment review (#562)"
```

### Task 3: Make the dashboard model fail closed and state-aware

**Files:**
- Modify: `src/components/features/dashboardModel.ts`
- Modify: `tests/unit/dashboardModel.test.ts`

- [ ] **Step 1: Write failing model tests**

Add focused cases proving:

- metadata-free legacy actions become possible and are never model-authorized for completion;
- possible actions with a valid `source_meeting_id` receive that exact meeting target and source/date basis;
- missing source meetings produce `Review task` and the owner/due-date fallback;
- confirmed actions retain normal status and completion authorization;
- possible blocker actions remain possible;
- rejected actions are excluded before counts and ordering;
- all-possible, mixed, all-confirmed, and empty summaries are exact and pluralized;
- possible stale rows expose `Needs review`, not a bare stale judgment.

Use synthetic meetings and metadata only.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run tests/unit/dashboardModel.test.ts
```

Expected: fail because the action-insight model has no commitment state, evidence target, allowed actions, or summary.

- [ ] **Step 3: Implement minimal state-aware model fields**

Extend each populated insight item with:

```ts
commitmentState: 'possible' | 'confirmed';
statusLabel: string;
basisLabel: string;
sourceMeetingId: string | null;
canComplete: boolean;
```

Extend the populated collection with `possibleCount`, `confirmedCount`, and `summary`. Parse metadata with the shared helper, exclude rejected rows before existing deduplication and ranking, and resolve persisted source meetings only from the matching meeting ID. Confirmation state must win over blocker presentation when deciding completion eligibility.

Keep existing urgency ordering inside the remaining rows and preserve confirmed-item behavior.

- [ ] **Step 4: Prevent possible actions from projecting commitment language into hero/briefing**

Feed hero and briefing builders only confirmed action arrays, or otherwise give them the same parsed authorization contract. Do not let a possible action appear as overdue/stale/active commitment copy elsewhere on the homepage.

- [ ] **Step 5: Run and verify GREEN**

Run the focused model suite and expect it to pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/dashboardModel.ts tests/unit/dashboardModel.test.ts
git commit -m "feat: classify dashboard follow-ups before ranking (#562)"
```

### Task 4: Render review controls and complete traceability

**Files:**
- Modify: `src/components/features/Dashboard.tsx`
- Modify: `src/App.tsx`
- Modify: `tests/unit/Dashboard.test.tsx`
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-08-03-562-trustworthy-dashboard-followups.md`

- [ ] **Step 1: Write failing renderer tests**

Add tests proving:

- possible rows contain `Needs review`, the state-aware section summary, `Review source` or `Review task`, `Confirm task`, and `Not a task`;
- possible rows contain neither a leading completion checkbox nor `Mark complete` / `Resolve blocker`;
- `Review source` invokes `setSelectedMeetingId` with the exact persisted source ID;
- confirmation and rejection handlers receive the action ID and exact next state;
- possible blocker rows still lack completion controls;
- confirmed routine and confirmed blocker fixtures retain their current controls;
- new controls have visible focus styling and specific accessible names.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run tests/unit/Dashboard.test.tsx
```

Expected: fail because the renderer still unconditionally renders completion controls.

- [ ] **Step 3: Render only model-authorized controls**

Add a dashboard prop:

```ts
handleReviewCommitment: (
  id: string,
  state: 'confirmed' | 'rejected',
) => Promise<void>;
```

Possible rows omit the leading check button. Their review-source action navigates using `sourceMeetingId`; source-less review stays within the row as a native `details` disclosure that explains no source meeting is available. Confirmation/rejection buttons call the review handler. Confirmed rows keep the existing checkbox, completion label, and attention lifecycle controls.

Replace `Only the highest-value signals` with the exact model summary.

- [ ] **Step 4: Wire App persistence and errors**

Add an App handler parallel to completion that uses `persistDashboardCommitmentReview` and `updateActionCommitmentState`, shares the updating-ID set, refreshes on success, and uses a review-specific error such as `Could not update follow-up review. Try again.`

- [ ] **Step 5: Record the durable decision and changelog**

Append a decision stating that completion eligibility comes only from explicit commitment state and that legacy/extracted actions fail closed. Create a changelog fragment with all required fields: Issue, PR (`pending` until PR creation), Changed, Why, Replaced, and Notes.

- [ ] **Step 6: Run focused verification and verify GREEN**

```bash
pnpm exec vitest run tests/unit/actionCommitment.test.ts tests/unit/relationshipInference.test.ts tests/unit/dashboardActionCompletion.test.ts tests/unit/dashboardModel.test.ts tests/unit/Dashboard.test.tsx
pnpm run changelog:check
```

Expected: all focused tests pass and the changelog fragment validates.

- [ ] **Step 7: Commit**

```bash
git add src/components/features/Dashboard.tsx src/App.tsx tests/unit/Dashboard.test.tsx docs/decisions.md docs/changelog/entries/2026-08-03-562-trustworthy-dashboard-followups.md
git commit -m "feat: review dashboard follow-ups before completion (#562)"
```

### Task 5: Final verification and delivery

**Files:**
- Modify only files required by verified review findings.

- [ ] **Step 1: Run complete relevant verification**

```bash
pnpm exec vitest run tests/unit/actionCommitment.test.ts tests/unit/relationshipInference.test.ts tests/unit/dashboardActionCompletion.test.ts tests/unit/dashboardModel.test.ts tests/unit/Dashboard.test.tsx
pnpm run lint
pnpm run build
pnpm run changelog:check
pnpm run audit:high
```

- [ ] **Step 2: Inspect final diff and requirements**

Run `git diff --check`, inspect `git diff origin/master...HEAD`, and match every design requirement to code or tests. Confirm no unrelated files changed and no private meeting content entered fixtures or docs.

- [ ] **Step 3: Obtain independent spec and code-quality review**

Provide the reviewer the design, plan, base SHA, head SHA, verification output, and complete diff. Fix every Critical or Important finding with a failing regression test first, then re-run the relevant verification and request re-review.

- [ ] **Step 4: Push and open the PR**

Push `codex/562-trustworthy-dashboard-followups`, open a ready PR linked with `Closes #562`, include verification evidence and durable decision/changelog notes, replace the changelog fragment's pending PR reference with the real PR number, commit and push that traceability update, then add the final issue comment.
