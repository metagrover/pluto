# General Identity Resolution Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded implementation and independent spec/quality reviews. Execute the tightly coupled integration in the parent task. The user approved implementation and shipping; no further routine approval gate is required.

**Goal:** Resolve commitment ownership from workspace-local people and meeting-local evidence, automatically reconcile affected pending suggestions, and ship only #679 changes.

**Architecture:** Reuse person entities and reversible commitment aliases. A pure resolver consumes explicit bindings and source turns; a database-scoped store persists self identity, capture snapshots, corrections, cached resolutions, and revisioned reconciliation jobs. Every publication and automatic recheck uses the same owner-identity boundary.

**Tech Stack:** TypeScript, Electron IPC, SQLite/better-sqlite3, React, Vitest, configured structured LLM provider.

## Execution workspace and verification

Work in `/Users/metagrover/Desktop/pluto/.worktrees/679-identity-resolution`, branch `codex/679-identity-resolution`, based on `origin/master`. Do not mutate the source checkout's unrelated Projects changes. First transfer the already-tested semantic commitment baseline without Project qualification changes.

Keep the shared native SQLite binary on Electron ABI. For Node-behavior unit tests use:

```sh
NODE_OPTIONS=--require=/tmp/pluto-679-tests.S3NJQ6/node-test-runtime.cjs ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ./node_modules/vitest/vitest.mjs run --silent
```

The preload deletes `process.versions.electron` so provider unit mocks cannot accidentally dispatch real inference. Focused pure tests can use `pnpm exec vitest run <file>`. Run `pnpm exec tsc --noEmit`, focused Biome, `git diff --check`, production Vite build, and full suite before shipping. Use separate opt-in manual tests for real-model acceptance and an isolated app-data directory for rendered interaction tests.

## Task 1: Isolate and verify semantic reconciliation baseline

- [x] Transfer only #679 files/hunks, plus queued cancellation support required by commitments.
- [x] Run commitment comparator, persistence, provider, and cancellation tests; run TypeScript.
- [x] Independently inspect the isolated diff for project imports or unrelated ahead commits.
- [ ] Commit the verified prerequisite as `fix: reconcile regenerated commitments by meaning (#679)` (deferred to one scoped combined feature commit after final acceptance evidence).

## Task 2: Pure evidence-backed owner resolver

Files: create `src/types/identity.ts`, `electron/identityResolution.ts`, `tests/unit/identityResolution.test.ts`.

Define these shared structures before consumers are written:

```ts
type IdentityPerson = { id: string; name: string };
type IdentityTurn = { id: string; speaker: string; text: string };
type IdentityEvidence = { turnId: string; quote: string };
type IdentityBinding = {
  speaker: string; personId: string | null; individual: boolean;
  source: 'user' | 'source'; sourceRevision: string;
  evidence: IdentityEvidence[];
};
type IdentityContext = {
  meetingId: string; sourceRevision: string; turns: IdentityTurn[];
  people: IdentityPerson[]; bindings: IdentityBinding[];
  capture: { origin: 'local' | 'imported' | 'unknown'; selfPersonId: string | null };
};
type OwnerResolution = {
  status: 'resolved' | 'unresolved' | 'conflicting';
  ownerKey: string | null; personId: string | null;
  source: 'user' | 'binding' | 'inference' | 'unresolved';
  evidence: IdentityEvidence[]; reason: string;
};
```

- [x] Write failing tests calling `resolveCommitmentOwner({text, ownerLabel, evidence, explicitPersonId}, context, PeerGenerate, signal)`. The generator uses `(prompt, schema parsableSchema, signal) => Promise<string>`. Assert explicit person IDs override inference, null owners stay unresolved absent evidence, same-name candidates stay distinct, imported `Me` never uses capture self, and aggregate speakers do not yield individual keys.
- [x] Implement the resolver with bounded, schema-validated source windows, supplied-only IDs, quote/reference validation, and a separate source-only verification request. Return `person:<id>` or a meeting-scoped individual-speaker key, never an owner-name key. First-person, named, collective, quoted, and ambiguous ownership must remain distinguishable. Infrastructure errors throw; genuine uncertainty returns unresolved.
- [x] Add tests for stale inferred bindings, conflicting corrections, missing/foreign evidence, cancellation, oversized inputs, repeated labels in distinct meetings, and failed verification. Run red then green for each group.
- [x] Export production prompt builders for the frozen local-model acceptance runner. Verify pure functions do not read global profile or database state.
- [x] Obtain independent spec review then quality review before committing.

## Task 3: Workspace-local persistence and durable jobs

Files: create `electron/identityStore.ts`, `tests/unit/identityStore.test.ts`; integrate initialization/revisions in `electron/db.ts`.

- [x] Write failing in-memory SQLite tests with two independent databases. Instantiate `createIdentityStore(sqliteConnection)` after minimal entities/meetings schema. Assert self selection in database A cannot affect B; explicit distinct creation permits duplicate display names.
- [x] Store self person ID, immutable capture-time origin/self snapshot keyed by meeting ID, meeting speaker corrections, cached action owner resolutions, a monotonically increasing evidence revision, and durable meeting jobs. Capture records must allow a recording ID before its eventual meeting row exists. Validate all selected person IDs against actual person entities.
- [x] Expose `getSelfPersonId`, `setSelfPersonId`, `getCapture`, `recordCapture`, `getBindings`, `setBinding`, `getRevision`, `getResolution`, `saveResolution`, `enqueue`, `nextJob`, `checkpointJob`, `failJob`, `retryJob`, and `getStatus`. Persist job target revision, cursor, attempts, and error; compare-and-swap updates must not erase newer work. Cached resolution keys include action/source/binding and person-candidate revisions.
- [x] Test profile changes do not mutate capture snapshots, clear/removal invalidates only dependent data, correction changes enqueue affected meetings, duplicate triggers coalesce, restart retains cursor, stale completion is rejected, and invalid writes roll back atomically.
- [x] Include identity revisions in commitment publication snapshots. Make human ownership edits explicit rather than treating old fuzzy `assigned_to` links as verified. Preserve original owner metadata.
- [x] Independent spec and quality review; focused tests; commit store and tests together as part of the scoped feature commit.

## Task 4: Shared publication and automatic background rechecks

Files: create `electron/commitmentIdentity.ts`, `electron/identityReconciliation.ts`, `tests/unit/identityReconciliation.test.ts`; modify `electron/entityPipeline.ts`, `electron/commitmentReconciliation.ts`, `electron/commitmentSemanticReview.ts`, provider structured options, `electron/db.ts`, and `electron/main.ts`.

- [x] Write failing integration tests where two differently labelled owners resolve to the same person and preserve an existing rejected canonical commitment. A same-name different-ID control must remain separate. Remove the legacy name-only eligibility fallback from production.
- [x] Build `IdentityContext` from original transcript turns, stored corrections, capture provenance, and actual person records. Do not promote channel fallback to individual-speaker reliability. Resolve both candidate and prior ownership, cache against current revisions, and pass resolved keys to semantic comparison while retaining labels for display/evidence.
- [x] Require configured generation in every action-bearing production extraction path. Propagate abort signals. Exact extraction IDs may skip repeated semantic inference only when identity evidence is still current.
- [x] Implement one bounded background work unit per call using durable `nextJob` and `checkpointJob`. Integrate start/resume, pause while capture/foreground analysis is active, cancellation, retryable failures with bounded attempts, and user-triggered retry. A deterministic unresolved result checkpoints instead of looping.
- [x] Enqueue after analysis/source changes, explicit speaker/owner corrections, and one-time legacy-pending migration. Persist cursors so partial progress survives restart. Do not enqueue unchanged source content endlessly.
- [x] Record identity evidence/revisions with aliases. On revocation, re-evaluate and restore unsupported system aliases through existing restoration, preserving canonical user state. Explicit human restore remains protected.
- [x] Test source/identity/user-review races, duplicate scheduling, restart, preemption, all caller paths, safe restoration, and failure recovery. Independent spec review then quality review completed.

## Task 5: Capture provenance and minimal correction controls

Files: modify `electron/captureJournalStart.ts`, `electron/main.ts`, `src/components/features/SettingsTab.tsx`, `src/components/features/MeetingView.tsx`; create `src/api/identity.ts`, `src/components/features/IdentitySettings.tsx`, `src/components/features/MeetingIdentityControls.tsx`; add focused IPC, capture, and DOM tests.

- [x] Write failing tests for capture-time snapshot, repeated journal resume, and failed capture start. Persist local provenance at the authorized capture boundary; never infer it in the model. Imported/legacy sources remain unknown unless explicitly established.
- [x] Add validated IPC/API operations to read identity state, select/create/clear self, read/save/clear meeting-scoped bindings, and read/retry reconciliation status. Saving a correction must atomically schedule re-evaluation. Reject malformed IDs, non-person IDs, unknown meeting/speaker labels, and conflicting updates.
- [x] Add a compact optional Settings section using existing form styles. Distinct same-name people remain selectable with ID disambiguation. Show save failure, pending, saved, and clear states without claiming old meetings were reassigned.
- [x] Add inline meeting speaker controls behind disclosure, preserving raw transcript labels. Require explicit individual-speaker scope for generic channel labels and allow clearing a correction. Display pending/running/failed reconciliation honestly and provide retry after transient failures.
- [x] DOM tests cover create/select/clear, keyboard labels, duplicate names, save/retry failures, switching meetings during requests, and persisted refresh. Rendered Electron validation used isolated synthetic data; post-polish interaction verification remains pending while macOS is locked.
- [x] Independent spec and quality review; commit verified controls with tests as part of the scoped feature commit.

## Task 6: Acceptance, shipping, and active-checkout handoff

- [x] Add frozen neutral source-grounded local-model cases to `tests/manual/identityResolutionAcceptance.test.ts`: valid aliases, unrelated participants, duplicate names, imported perspective, first-person, named assignment, quotation, collective, ambiguous and conflicting evidence. The production resolver and verifier were used. Five of fourteen cases ran before the bounded capacity stop: two safe semantic false negatives, three no-packet capacity errors, zero successful final resolutions, and no accuracy claim. Nine cases remain unevaluated; full evidence is recorded separately.
- [x] Verify the automatic correction-to-job-to-canonical-commitment path in isolated persisted database tests and a rendered isolated app. Reviewed records are preserved byte-for-byte and restoration is covered. Final post-polish form interaction/restart QA remains blocked by macOS interaction control; backend and DOM persistence tests pass.
- [x] Run full tests, TypeScript, focused lint, diff check, production build, and private-data scan. Review the entire isolated diff, including prerequisite semantic changes, against all thirteen specification acceptance cases. Final evidence: 251 files / 2,995 tests, TypeScript and production build green, 45-file Biome green, diff check clean, and independent final-delta review 118/118.
- [x] Update `docs/decisions.md`, an issue-linked changelog fragment, the approved specification status, and task checkboxes with actual evidence. Do not edit archived `docs/CHANGELOG.md` or create a competing Markdown backlog.
- [ ] Ship only this branch after fresh review/tests. Use the repository release conventions, not an invented four-part VERSION scheme if none exists. Inspect PR checks and address owned failures. Do not publish unrelated source-checkout commits.
- [ ] Apply the reviewed feature delta back to the active checkout only after checking overlapping edits and preserve the user's other work. Verify the active app separately from isolated tests. If safe application requires an unresolved overlapping change, report that specific blocker rather than claiming the worktree is already live.

## Self-review

All thirteen acceptance cases are covered by Tasks 2–6. The resolver never treats names as identity keys; recording provenance does not prove microphone speaker identity. Storage is database-scoped, corrections are revisioned, and automatic jobs are part of delivery. No live personal-data cleanup or profile seeding is included. No external identity integration or unrelated Projects work is included.
