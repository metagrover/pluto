# Meaningful Projects Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the qualification boundary and review. Root integrates the read model, bounded review, and UI. Steps use checkbox syntax for tracking.

**Goal:** Raise project qualification and restore a calm evidence-backed Projects overview (#677).

**Architecture:** Versioned qualification metadata separates semantic scope from lifecycle. Extraction and bounded legacy review share a quote-validating boundary. Existing records remain accessible; only qualified initiatives enter the overview.

**Tech Stack:** TypeScript, React, Electron IPC, SQLite, existing local LLM provider, Vitest.

### Task 1: Qualification and extraction
- [x] Add `src/utils/projectQualification.ts` and red/green `tests/unit/projectQualification.test.ts` tests for missing, malformed, unsupported, subordinate, and independently grounded proposals.
- [x] Extend `electron/llm/provider.ts` and `electron/llm/prompts.ts` with nested qualification proposals.
- [x] Update `electron/entityPipeline.ts` to persist validated qualification without erasing user overrides, remove co-occurrence membership, and cover extraction in `tests/unit/projectExtractionQualification.test.ts`.
- [x] Verify `pnpm exec vitest run tests/unit/projectQualification.test.ts tests/unit/projectExtractionQualification.test.ts`.

### Task 2: Existing evidence review and read model
- [x] Add `electron/projectScopeReview.ts`: one bounded batch per request, deduplicate concurrent calls, use source transcript evidence, fail closed and preserve prior metadata. Persist results with source and assessment date; omit raw evidence from logs.
- [x] Add `getProjectPortfolio` in `electron/db.ts` with meeting count, latest source context, last activity, and canonical entities. Add `GET_PROJECT_PORTFOLIO` and `REVIEW_PROJECT_SCOPE` IPC handlers plus typed API wrappers.
- [x] Add tests before implementation covering capped work, malformed output, transient provider failure, user override preservation, and source quote validation. Verify with `pnpm exec vitest run tests/unit/projectScopeReview.test.ts`.

### Task 3: Calm overview and usable dossier
- [x] Add an independently tested portfolio model for qualification lanes, search, and chronology. Keep unsupported legacy records accessible without claiming semantic completion.
- [x] Replace the landing render in `src/components/KnowledgeGraph/ProjectsExecutionTab.tsx` with restrained rows, useful context, search, review progress/retry, and secondary disclosures. Preserve exported legacy helpers used elsewhere.
- [x] Replace permanent placeholders in `src/components/features/projects/ProjectDossier.tsx` with real source meetings and honest empty/error states. Wire `onOpenMeeting` through `src/App.tsx`.
- [x] Update interaction tests, run focused tests, and verify no lost route or source access.

### Task 4: Review and delivery
- [x] Run qualification, pipeline, review, Projects, dossier, prompt tests and focused Biome plus `git diff --check` and TypeScript.
- [x] Review spec compliance, then code quality, fix actionable findings.
- [x] Update `docs/decisions.md` and a uniquely named changelog fragment; run `pnpm run changelog:check`.
- [x] Apply verified work to the active checkout without disturbing unrelated changes, confirm Electron ABI, and inspect real rendered overview, secondary list, and dossier. Report actual review progress and any remaining uncertainty without claiming all candidates qualified.

## Verification record

- 246 test files, 2,761 tests passed after the final provider scheduling change.
- TypeScript, focused Biome, and diff whitespace checks passed.
- Changelog validation reports only the pre-existing malformed `2026-08-27-align-knowledge-projects-design-system.md` fragment.
- Applied implementation to the active checkout on `codex/677-projects-live`; no commit or push performed.
- Real Electron overview and expanded secondary entries were visually inspected before the final backend restart; dossier navigation was verified through accessibility state. After the restart, the renderer was blank during final inspection, so final live verification and existing-data review remain incomplete.
- A local database backup was saved before review. Latest aggregate check found 127 entries still awaiting scope assessment; no corpus contents were added to the repository.

### Follow-up: stalled review

Queued model work now honors caller cancellation, removes expired entries, and permits a fresh retry. Projects review uses priority 15 while open (chat remains 20); resumable notes yield rather than starving the visible review. Recording/finalization gates are unchanged. Each request reviews one candidate to reduce local-model batch timeouts. Regression tests reproduced both queue cancellation and scheduling failures before their fixes; all 2,762 tests pass after the changes. Live cancellation was observed releasing the request after 120 seconds with a Retry control. Live incremental reassessment is verified: the first one-candidate request completed in 23.8 seconds, persisted its result, and the next request started automatically (127 pending became 126). The full existing-data review remains in progress. The development app was reconnected by restarting Vite explicitly on 127.0.0.1 after connection-refused errors during restarts.

### Follow-up: active generation timeout

User-provided logs confirmed a projectScopeReview abort at 90 seconds while the notes queue resumed normally. The review was still using the non-streaming transport and its fixed request timeout. It now uses the existing progress-aware stream deadline (90 seconds for first progress, 60 seconds idle), with a five-minute caller cap. Regression assertion failed on stream:false before the fix and passes on stream:true. All 2,762 tests, TypeScript, focused Biome, and diff checks pass. Full live reassessment after this change has not yet been verified.

### Approved repair: malformed response blocks the portfolio (2026-08-28)

User approved the focused repair after a live `project_scope_response_incomplete` reproduction. Continue in the active dirty checkout, preserving prior work; do not commit or push unrelated changes.

- [ ] Add red/green service regressions: malformed output returns the failed candidate ID without saving qualification; subsequent calls exclude failed IDs and process other pending candidates; excluded candidates remain pending and can be retried.
- [ ] Pass a per-request JSON schema through `synthesizeKnowledgeDocument({ purpose: 'projectScope', responseSchema })`, constraining exact candidate/source IDs and qualification structure. Preserve evidence validation and reject incomplete/truncated responses.
- [ ] Thread `excludeProjectIds` through the Projects API and IPC. Keep exclusions in the overview session, continue remaining candidates, stop after one pass, and clear exclusions on explicit Retry. Provider outages stop the run; candidate response failures do not.
- [ ] Add renderer regressions for continuation, bounded exhaustion, Retry, and inactive-review copy. Keep layout and qualification bar unchanged; retain all records.
- [ ] Run focused tests, full suite, typecheck, Biome, diff checks, restore Electron SQLite ABI if rebuilt, and inspect live Projects progression across multiple saved candidates.

Commands: `pnpm exec vitest run tests/unit/projectScopeReview.test.ts tests/unit/ProjectsExecutionTab.test.tsx tests/unit/unifiedProvider.test.ts`; `pnpm exec tsc --noEmit`; `pnpm exec vitest run`; `git diff --check`.

#### Response-repair verification (2026-08-28)

- Malformed-response isolation, bounded pass/retry, concurrent-classification reconciliation, and truthful error-state tests passed red/green.
- Live read-only model reproduction found the exact remaining mismatch: a task response supplied evidence under workItems but left outcomeEvidenceQuote empty. Revised per-kind schema requires task/topic evidence in that field, permits zero workItems for non-initiatives, and preserves explicit uncertainty.
- The same real candidate/source replay then produced a grounded subordinate assessment (normal model stop, 159 output tokens). Independently replayed the captured response against current service and current read-only source rows: reviewed=1, subordinate; save captured in memory only, no database writes.
- Final full suite: 246 files / 2,779 tests pass. TypeScript, focused Biome and diff checks pass. Electron SQLite binding restored and verified. Changelog checker flags only the pre-existing malformed August 27 fragment.
- All temporary diagnostic logging removed. No commit or push.
- Final rendered-app verification remains incomplete. Repeated dev restarts surfaced blank renderer states; an older packaged #608 Pluto instance remains running against the same user-data directory. User permission to close that older instance was requested; it has not been terminated. Do not report full live corpus completion from the isolated replay.

## Approved follow-up: recover unresolved scope reviews

User approved on 2026-08-28 after a live audit found 79 unassessed records treated as finished and relevant source history excluded.

- [x] Evidence selection: add deterministic bounded retrieval across linked validated history; test older substantive evidence and partial candidate names before implementation. Supply all linked transcript text from main; keep source IDs and verbatim quotes.
- [x] Qualification/review: add explicit unresolved reasons and review revision metadata. Test legacy unassessed reconsideration, preserved user decisions, and one attempt per pass. Keep strict grounding; unresolved results remain pending but are excluded for the rest of the current pass.
- [x] Overview: show unresolved count and reasons with Retry. Automatically reconsider legacy unresolved results once; current-revision unresolved results wait for explicit Retry, including across navigation. Test continuation, exhaustion, retries, and concurrent correction.
- [x] Verify focused tests, types, lint, full regression suite as practical; review spec compliance then code quality. Run read-only representative real-source evaluation before live reassessment, then inspect rendered Electron. Preserve unrelated dirty work; no commit/push or destructive data migration.

### Revised-review verification (2026-08-28)

- Bounded relevant-history selection recovers the previously omitted strategy source and milestone passage without changing quotations or writing private corpus text to the repository.
- Three real Qwen scope evaluations completed through the production provider in 26.2s, 96.7s, and 79.2s after clearing a released-but-resident Gemma runner. All used save spies; no database writes. The concrete labels remained safely unresolved because each is a phase or umbrella rather than the broader outcome described in source.
- A 96.7s successful buffered response reproduced the old 90s first-packet false timeout. The project-scope capacity window is now 180s, still beneath the existing 300s IPC caller cap; focused timeout regression passes.
- Final focused verification: 5 files / 136 tests. Full deterministic suite: 250 files / 2,879 tests. TypeScript, focused Biome, diff checks, and Electron SQLite ABI verification pass.
- Pluto renders successfully after the ABI restore. Projects navigation was deliberately not triggered because it would mutate all legacy unresolved records before the newly identified initiative-discovery design is approved.
- Remaining product gap: the persisted candidate corpus contains phases, workstreams, and umbrella labels. Conservative reclassification cannot create the broader initiatives established by their conversations. Outcome discovery must create a new source-grounded initiative entity and only attach constituent work when direct evidence establishes membership; no existing entity may be renamed, deleted, or heuristically merged.

## Approved follow-up: source-grounded initiative discovery

User approved this extension on 2026-08-28 and asked to continue through real rendered verification.

- [x] Add red/green service tests for one-source bounded discovery, exact-quote validation, deterministic IDs, no-result completion, retryable provider failure, idempotent replay, and concurrent/user-edit preservation.
- [x] Add durable per-source discovery state keyed by contract version and source revision. Prioritize validated sources already linked to multiple project candidates, but keep the pass resumable for the full eligible source set.
- [x] Persist only newly discovered, independently qualified initiatives and their source meeting association. Do not mutate, merge, rename, or parent-link existing entities.
- [x] Run discovery before legacy candidate review in the Projects overview, surface truthful discovery progress, and refresh the portfolio after each result.
- [x] Verify with focused and full tests, TypeScript, Biome, diff checks, a read-only real-model probe, a backed-up live database pass, and rendered overview plus dossier/source navigation.

### Initiative-discovery verification record

- The final concise extraction contract asks for one supported goal and two cohesive concrete actions, then validates every quote against the full transcript. It is source-centered and does not treat existing fragment names as evidence.
- A real Qwen production-provider save-spy run on a private representative planning source produced a qualified initiative in 110.2 seconds. The proposal contained three actions; two were exact source quotes and the optional third used an unsupported ellipsis. Validation discarded the unsupported optional item and retained the two separately grounded actions. No database write occurred in this probe.
- Focused discovery, qualification, review, evidence, provider, and overview tests pass. A database backup exists at `/tmp/pluto-677-before-initiative-discovery-20260828-174509.db`.
- Final deterministic verification passes: 251 files / 2,889 tests, TypeScript, focused Biome, diff checks, and the Electron SQLite ABI check.
- Backed-up live persistence renders in the Projects overview. The `Sandbox Environment Stabilization and Demo Preparation` row opens a dossier with its grounded outcome, the honest `Work described in the sources · not completion status` label, and the July 8 source meeting.
- The dossier source control opens `Demo Progress and iOS Client Development Plan` in the rendered Electron app, showing the July 8, 2026 meeting overview and transcript access. This closes the prior lock-screen verification gap.
