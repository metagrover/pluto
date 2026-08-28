# PR #676 final fidelity implementation plan

> **For agentic workers:** use subagent-driven-development to implement and independently review the bounded tasks below.

**Goal:** Finish issue #674 without publishing incomplete or unsupported notes, changing the user's chosen model, or touching existing saved notes.

**Architecture:** Keep the existing local writer/auditor and their one-repair limits. Improve completeness and person-reference guidance inside the same audit. The initially approved canonical-source withdrawal witness failed adversarial review and is being removed; it must not be shipped. Neither exact citations nor passing structural checks establish semantic fidelity.

**Stack:** TypeScript, Vitest, Electron, local Ollama. Work only in `.worktrees/674-source-grounded-notes` on `codex/674-source-grounded-notes`.

**Approval:** The user approved this continuation with “Sure, go ahead” after the plain-language explanation. The earlier source-grounded notes design and issue #674 remain authoritative. No provider promotion, production regeneration, cloud processing, extra retry loop, or new pipeline stage is approved.

## Task 1 — Correct the mixed-evidence false rejection

**Design blocked after implementation review.** The literal witness fixed the frozen example but wrongly accepted later restarts phrased without familiar person/event markers. Closed task-related stative frames still failed on unresolved references such as “We are doing it” and “It is proceeding.” Rejecting every pronoun would reject valid original discussion; expanding a fixture-shaped whitelist is not acceptable. Passing selected regressions is not completion. Remove the override and keep the existing fail-closed path. A smaller alternative—have the existing auditor repair supporting citations within its unchanged one-repair budget—was proposed to the user; revised approval is pending. The checklist below records the attempted design, not completed acceptance.

- [ ] Add a red regression replaying the unchanged frozen R12/R13 item from `tests/manual/fixtures/meetingNotesCompletionGuidanceSeed41.json`.
- [ ] Reuse exact sentence/spans/speaker/order extraction from `electron/llm/meetingNotesGuardrails.ts`; add a focused pure source-withdrawal witness module if needed. Do not use fuzzy subset task matching as proof.
- [ ] Require unique actor/task/recipient/condition agreement, explicit unnegated withdrawal, full scope, and no later same-task renewal or unresolved related reversal within permitted source context.
- [ ] Integrate only at the failed-polarity check in `electron/llm/analysisGrounding.ts`. Keep every other grounding check and the original text/citations unchanged.
- [ ] Pass permitted source context from `electron/llm/meetingNotesPipeline.ts` through `electron/llm/meetingNotesAudit.ts`, with editor parity. Leaves cannot inspect unseen source.
- [ ] Add adversarial actor/task/recipient/scope, negated/quoted withdrawal, compound task, prerequisite, duplicate promise, renewal outside item citations, unrelated-negation, and leaf-boundary tests.
- [ ] Run focused `pnpm exec vitest run tests/unit/meetingNotesAudit.test.ts tests/unit/meetingNotesGuardrails.test.ts tests/unit/meetingNotesPipeline.test.ts tests/unit/analysisGrounding.test.ts tests/unit/meetingNotesWithdrawal.test.ts`. Run TypeScript, scoped Biome and `git diff --check`.
- [ ] Complete independent specification review, then code-quality review. Fix findings before moving on.

## Task 2 — Improve source completeness without adding stages

- [x] Write failing guidance-contract tests before editing `electron/llm/meetingNotesGuidance.ts` and `electron/llm/meetingNotesPrompts.ts`.
- [x] Revise the compact shared policy, preserving its 350-word budget and exactly three examples: retain all material operations and their current status across turns; state explicit latest offer disposition; use supported names or neutral wording when pronouns are unknown. Silence is not rejection and completed work is not a future action.
- [x] Use the same source-first auditor and existing edits/verdicts. Do not add semantic regex gates or a self-certified coverage field.
- [x] Freeze prospective controls and held-out examples before inference: already-completed preparation, different preparation owner, upload-only acceptance, supported/unrelated/quoted pronouns, unaccepted/declined/conditional/renewed offers, and reordered sanitizing/importing, calibration/shipping, proofreading/submitting domains.
- [x] Bump prompt identities to notes-v24/v25. Keep guardrails-v3 after removing the unsafe witness. Keep prior raw evaluations and scores unchanged.
- [x] Run focused prompt/guidance tests and independent specification then quality review.

The six prospective fixtures have SHA-256 `f88b7c01c41af1b7b06c33e265e99896504c363bf2ced11f55c144e39f556a67`. Review before inference corrected overly strict grouping counts: sanitizing/importing may be one or two actions, and narration refusal/text-only selection may be combined or separate. Original fixed-case data and criteria are unchanged. These count ranges do not establish semantic fidelity.

A read-only snapshot of one existing 240-turn recording and seven source-derived criteria is stored outside the repository for private acceptance (SHA-256 `f96b03a8fb08fbaeeedd283546bc4b71d02b1fb46aefccfee8257c029e90f434`). Production notes/settings are not regenerated or modified. Private source and responses must not be committed or posted.

## Additional release-review corrections

- [x] Automatic secondary retries had the same old-document/new-run race previously fixed only for explicit retries. Extend the snapshot refresh to every path after provider initialization; observed red/green and independent specification/quality review pass.
- [x] Fix a synchronous Unicode partitioning loop: adjust code-point-safe span endpoints without reusing the adjusted midpoint for binary-search progress. Four guarded regressions observed red then green; independent review additionally exercised 10,025 ASCII/emoji capacity cases.
- [x] Preserve the actual resolved local model in notes metadata and stage-cache identity, pinned across the run; preserve pre-cancelled requests' zero-transport behavior. Independent specification/quality review passed, including fallback discovery changing between requests.
- [x] Preserve bounded HTTP error bodies privately in Electron so reported context overflow can trigger the existing bounded repartition path. Never expose error bodies as generated tokens or log them. Independent specification/quality review passed.

## Task 3 — Measure actual note quality

- [x] Run the four original fixed cases with the installed `gemma4:12b`, seed 41, temperature 0.1, context 16384, thinking disabled. Preserve every response and judge against the original criteria; rejected runs are not successful samples. Three returned documents, one rejection; only the personal case passes all original fidelity criteria. See the [fresh evaluation report](2026-08-27-pr676-final-fidelity-review.md).
- [x] Run all six prospective held-out controls and preserve every response/failure. Four returned documents; three meet all frozen fidelity criteria.
- [ ] Run representative read-only real-source and oversized hierarchical acceptance after the fidelity blockers are resolved. Never commit private transcripts or regenerate production meetings.
- [x] Inspect all final text in both synthetic batches against source, including names/pronouns, preparation, offer status, withdrawal reasons, conditions, ownership, deadlines and personal context. Report mechanical and semantic results separately.

## Task 4 — Release checks and honest delivery

- [x] Sequentially rebuild worktree SQLite for Node, await completion, run the complete suite with two workers, TypeScript, scoped Biome, changelog validation and dependency audit. Do not rebuild native modules during tests. Final safe code: 235 files / 2,619 tests passed.
- [x] Build with `pnpm run build --publish never`, verify packaged runtime, restore worktree Electron SQLite and check it. Preserve the main checkout and its dependencies. Explicit rebuild after both manual batches passed; Electron 40.8.0 / ABI 143 in-memory query succeeded.
- [ ] Recheck the real rendered app using only a disposable synthetic profile: title conflicts, successful regeneration/history, and failure feedback. Do not bypass a locked Mac or claim unseen visual success.
- [ ] Review the entire PR, update the existing issue-674 changelog fragment and completion report, commit/push only owned work, and update issue/PR evidence.
- [ ] Mark ready/merge only if required acceptance passes. Otherwise keep draft and report the specific remaining blocker in simple language.
