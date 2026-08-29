# Semantic Commitment Reconciliation Implementation Plan

> **For agentic workers:** Use test-driven development and bounded independent review. The approved design is in `docs/superpowers/specs/2026-08-28-commitment-semantics-design.md`.

**Goal:** Stop paraphrased commitments resurfacing and safely reconcile existing pending duplicates (#679).

**Architecture:** A pure provider-backed comparator returns validated semantic identity decisions. The entity publication boundary serializes comparison and atomic persistence; aliases retain provenance without reopening reviewed commitments.

**Tech Stack:** TypeScript, existing LLM provider, SQLite, Vitest.

## Task 1 — semantic comparator

- [x] Add `tests/unit/commitmentSemanticReview.test.ts` first: paraphrase reuse, distinct/uncertain retention, malformed and unknown IDs, all prior batches, abort, and earlier-candidate history ordering. Example invariant: `expect(matches.get('candidate')?.matchId).toBe('reviewed')` for a valid provider decision and reject unknown identities. Real-model follow-up added single-candidate isolation and validated-match early exit tests.
- [x] Run focused tests and observe missing behavior before implementation.
- [x] Add `electron/commitmentSemanticReview.ts`: typed context records, bounded schema requests, semantic instructions, complete response/ID validation, abort checks, no text-overlap matching.
- [x] Repeat focused tests until green and independently review spec coverage.

## Task 2 — durable identity and queue cleanup

- [x] Add DB-backed regression cases in `tests/unit/commitmentReconciliation.test.ts` before implementation. Assert reviewed records are byte-for-byte preserved, duplicate extraction IDs resolve to canonical IDs, pending duplicates are hidden without losing review history, restore is reversible, stale snapshots reject writes.
- [x] Add guarded transactional persistence in `electron/db.ts` and orchestration in `electron/commitmentReconciliation.ts`. Add explicit supersession filtering in shared commitment interpretation/query boundaries.
- [x] Integrate common extraction publication and notes-secondary provider forwarding in `electron/entityPipeline.ts` and `electron/main.ts`. Extend the existing provider purpose/schema mechanism with a dedicated semantic task.
- [x] Run new tests plus entity idempotency, dashboard and meeting-analysis tests. Assert provider failures leave the queue unchanged and obsolete runs cannot publish.

## Task 3 — verification and existing data

- [x] Run configured-model neutral fixtures separately from mocked tests, including different owner, deadline, recurrence and negation controls. The original eight cases plus two shared-context controls pass with Qwen after single-candidate proposal and pairwise verification. Earlier batched and unverified preview results were rejected, not applied.
- [x] Run semantic cleanup preview against a private backup and apply only guarded reversible supersessions. Seven pending records examined; one verified duplicate retired; all 207 action records retained and all 200 previously non-pending records unchanged. Six suggestions remain, including unresolved first-person/name ownership differences. The rejected earlier report cannot pass the new review-version guard. No private content is committed.
- [x] Run TypeScript, focused Biome, `git diff --check`, changelog validation and the full unit suite. Electron SQLite ABI remains intact: tests run under Electron with `process.versions.electron` removed in a temporary preload so mocked transport stays on the Node path. 249 files / 2,861 tests pass; production build passes. The dedicated fragment validates; global changelog validation is blocked by an unrelated pre-existing fragment.
- [x] Review the completed slice independently. Record decisions and verification in #679, `docs/decisions.md`, and the dedicated changelog fragment. Preserve unrelated local work. Explicit owner alias confirmation remains a separate user choice; do not infer identities to clear the queue.

### Local maintenance and restoration

`tests/manual/commitmentQueueMaintenance.test.ts` is deliberately opt-in. It requires `RUN_COMMITMENT_QUEUE_MAINTENANCE=1`, an absolute `PLUTO_COMMITMENT_DB_DIR` containing `pluto.db`, and an absolute private `COMMITMENT_REVIEW_REPORT` path. Run with `vitest.manual.config.ts` and an ABI-compatible runtime. Preview against a fresh backup after active analysis settles, review the private aliases, then use `COMMITMENT_REVIEW_MODE=apply` against the live directory. A changed queue/source revision rejects the entire application. Restore an individual extraction with `COMMITMENT_REVIEW_MODE=restore` and `COMMITMENT_RESTORE_ID`; restoration retains the original record and protects it from subsequent automatic cleanup. Never commit database backups or private review reports.
