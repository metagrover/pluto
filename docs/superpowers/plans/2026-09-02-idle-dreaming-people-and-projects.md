# Stable Background Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unsafe direct dreaming mutations with revision-scoped, evidence-validated proposals that users can accept or reject from People and Project dossiers.

**Architecture:** A bounded packager computes the entity source revision, Gemma returns strict proposal output, a fail-closed validator persists proposals atomically, and dossier actions apply or reject one current proposal transactionally. A dirty scheduler runs one canonical entity at a time through Pluto's serialized inference gate with preemption, timeout, backoff, and unload.

**Tech Stack:** TypeScript, Electron, React, Better-SQLite3, Vitest, Ollama through Pluto's unified provider.

---

## File structure

- `electron/dreaming/types.ts`: package, run, proposal, evidence, and result contracts.
- `electron/dreaming/packageEntityNotes.ts`: bounded one-read evidence package and deterministic source revision.
- `electron/dreaming/prompt.ts`: exact Gemma prompt and strict response schema.
- `electron/dreaming/validateDreamingOutput.ts`: schema, source, excerpt, correction, and duplicate validation.
- `electron/dreaming/proposalStore.ts`: transactional run/proposal persistence and guarded decisions.
- `electron/dreaming/entityQueue.ts`: canonical dirty selection and retry eligibility.
- `electron/dreaming/idleDreamingCoordinator.ts`: lifecycle, gate, timeout, preemption, late-result rejection, and unload.
- `electron/db.ts`: schema migration and canonical apply/reject transaction adapters.
- `electron/main.ts`, `src/api/knowledgeGraph.ts`: typed IPC.
- `src/components/features/dreaming/PreparedUpdates.tsx`: shared proposal review UI.
- `src/components/features/projects/ProjectDossier.tsx`, `src/components/KnowledgeGraph/PeopleTab.tsx`: entity-scoped integration.
- `tests/unit/*dreaming*`, `tests/unit/PreparedUpdates.dom.test.tsx`: contract, persistence, lifecycle, and UI coverage.

### Task 1: Replace the output contract and add exact prompt coverage

**Files:** `electron/dreaming/types.ts`, create `electron/dreaming/prompt.ts`, `tests/unit/validateDreamingOutput.test.ts`, create `tests/unit/dreamingPrompt.test.ts`

- [ ] Write a failing prompt test that packages two notes and expects both meeting IDs, both note bodies, all corrections, the fixed prompt version, and the strict proposal schema to reach the production generator request.
- [ ] Run `pnpm exec vitest run tests/unit/dreamingPrompt.test.ts` and confirm it fails because the prompt builder does not exist.
- [ ] Define `DreamingProposalKind`, evidence references, raw output, validated proposal, run status, and result unions. Remove the direct dossier mutation output types.
- [ ] Implement the type-specific Gemma prompt and strict schema with `additionalProperties: false`, required status, required proposal fields, and explicit `no_change` semantics.
- [ ] Run the prompt and validator tests and confirm they pass.

### Task 2: Build bounded packages and deterministic revisions

**Files:** `electron/dreaming/packageEntityNotes.ts`, `electron/db.ts`, `tests/unit/packageEntityNotes.test.ts`

- [ ] Add failing tests for one bounded query, canonical-family aggregation, newest-eight ordering, 1,600-word truncation, transcript exclusion, baseline/corrections inclusion, and stable/change-sensitive SHA-256 revisions.
- [ ] Run `pnpm exec vitest run tests/unit/packageEntityNotes.test.ts` and confirm the new cases fail for the expected unbounded/N+1 behavior.
- [ ] Add a database projection returning only structured-note fields required by dreaming, then implement deterministic bounding and revision hashing.
- [ ] Run the package tests and confirm they pass without selecting transcript or audio fields.

### Task 3: Persist runs and proposals atomically

**Files:** create `electron/dreaming/proposalStore.ts`, `electron/db.ts`, create `tests/unit/dreamingProposalStore.test.ts`

- [ ] Add failing database tests for run uniqueness, atomic proposal insertion, no-change with zero proposals, failed insertion rollback, stale running lease recovery, two-attempt backoff, and content-free failure codes.
- [ ] Run `pnpm exec vitest run tests/unit/dreamingProposalStore.test.ts` and confirm the schema/API is absent.
- [ ] Add `entity_dreaming_runs` and `entity_dreaming_proposals` with constraints and indexes; implement transactional start, complete, fail, cancel, list, and stale operations.
- [ ] Run proposal-store tests and confirm they pass.

### Task 4: Make validation fail closed

**Files:** `electron/dreaming/validateDreamingOutput.ts`, `tests/unit/validateDreamingOutput.test.ts`

- [ ] Add failing cases for unknown/missing status, proposals under `no_change`, unknown fields/kinds/meetings, empty or unmatched excerpts, one-source project summaries, correction collisions, and duplicate fingerprints.
- [ ] Run the validator test and confirm each new case fails against the permissive validator.
- [ ] Implement whole-output rejection with conservative excerpt normalization and deterministic fingerprints. Return a discriminated validation result rather than nullable output.
- [ ] Run validator tests and confirm all invalid payloads produce no accepted proposals.

### Task 5: Replace direct reconciliation with guarded canonical decisions

**Files:** `electron/dreaming/reconcileDreamingOutput.ts`, `electron/dreaming/proposalStore.ts`, `electron/db.ts`, `tests/unit/reconcileDreamingOutput.test.ts`, `tests/unit/entityCorrections.test.ts`

- [ ] Add failing tests proving generation cannot mutate canonical entities, acceptance is current-revision and pending-status guarded, rejection and correction are one transaction, generated milestones retain generated provenance, and a database failure rolls back every write.
- [ ] Run the reconciliation and correction tests and confirm the direct-write implementation fails them.
- [ ] Replace generation reconciliation with proposal persistence. Implement explicit transaction adapters for each supported kind using canonical Project/People/commitment/alias structures; never infer commitment ownership or silently merge an existing identity.
- [ ] Ensure all correction-aware read/rebuild paths exclude rejected fingerprints after reload.
- [ ] Run the reconciliation and correction tests and confirm they pass.

### Task 6: Implement dirty scheduling and preemptible lifecycle

**Files:** `electron/dreaming/entityQueue.ts`, `electron/dreaming/idleDreamingCoordinator.ts`, `electron/main.ts`, `electron/serializedTaskGate.ts`, `tests/unit/entityQueue.test.ts`, `tests/unit/idleDreamingCoordinator.test.ts`

- [ ] Add failing tests for unchanged-revision suppression, canonical alias exclusion, different-entity concurrency, foreground-lock preemption, late-result rejection, three-minute timeout, two-attempt backoff, manual entity scope, and unload after batch/preemption.
- [ ] Run the queue/coordinator tests and confirm they fail against round-robin and globally coalesced behavior.
- [ ] Select only current dirty canonical entities; integrate generation with the serialized gate and pause events; guard persistence with lease and eligibility rechecks; add deadline, retry, and unload behavior.
- [ ] Remove overview-wide arbitrary Dream Now and direct interval resynthesis.
- [ ] Run the lifecycle tests and confirm they pass.

### Task 7: Add prepared-update review to both dossiers

**Files:** create `src/components/features/dreaming/PreparedUpdates.tsx`, `src/api/knowledgeGraph.ts`, `electron/main.ts`, `src/components/features/projects/ProjectDossier.tsx`, `src/components/features/projects/ProjectMilestones.tsx`, `src/components/KnowledgeGraph/PeopleTab.tsx`, create `tests/unit/PreparedUpdates.dom.test.tsx`, `tests/unit/ProjectDossier.test.tsx`, `tests/unit/PeopleTab.identity.dom.test.tsx`, `tests/unit/PeopleTab.loading.dom.test.tsx`

- [ ] Add failing DOM tests for entity-scoped preparation, evidence disclosure, Accept, Reject, stale/failed states, accurate result messaging, durable reload, keyboard focus, and updated IPC mocks.
- [ ] Run the focused DOM tests and confirm the missing UI and stale mocks fail.
- [ ] Implement the compact shared review section and typed IPC. Refresh only the affected dossier after a successful decision.
- [ ] Remove passive `role=alert`, add visible focus treatment, and keep controls at least 44px on touch layouts.
- [ ] Run the focused DOM tests and confirm they pass.

### Task 8: Record decisions and verify production behavior

**Files:** `docs/decisions.md`, `docs/changelog/entries/2026-09-02-586-idle-dreaming-people-projects.md`, tests under `tests/unit/`

- [ ] Record the proposal-first trust boundary and fixed Gemma/Phi role split. Replace the changelog fragment's unverified behavior claims and give it a unique issue-compatible identifier.
- [ ] Run focused dreaming tests, `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run changelog:check`, `git diff --check`, and `pnpm test`; fix only regressions introduced by this branch.
- [ ] Rebuild the Electron SQLite ABI, back up the production database, and run Pluto against the normal profile.
- [ ] Trigger bounded proposal preparation for representative People and Project entities. Verify every persisted proposal resolves to supplied structured-note evidence and that no canonical record changes before explicit acceptance.
- [ ] Exercise one accept and one reject only on reviewed low-risk dogfood proposals; verify canonical display, provenance, correction durability, source-revision invalidation, and database integrity.
- [ ] Restore the Node SQLite ABI and rerun the focused persistence tests.
- [ ] Commit the verified implementation with issue traceability. Do not push or merge without an explicit delivery choice.
