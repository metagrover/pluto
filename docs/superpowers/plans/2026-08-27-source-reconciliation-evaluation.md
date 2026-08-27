# Source Reconciliation Evaluation and Integration Plan

> **For agentic workers:** Use `subagent-driven-development` and TDD; retain independent spec and quality reviews. This is the user-approved continuation of #674 after checkpoint `3388d6b51`.

**Goal:** Prove that a focused source-only stage reliably resolves meeting facts and current commitments before integrating it into readable note composition.

**Architecture:** The reconciler receives the original immutable source, never an earlier draft. Its flat response separates facts, accepted actions, settled decisions and unresolved questions, each with exact source references. Composition remains a separate responsibility and cannot drop, reassign or change the conditions/deadlines of reconciled commitments. Production remains unchanged until real-provider gates pass.

**Tech stack:** Existing TypeScript source/grounding/wire contracts, Vitest, configured local Ollama `qwen3.5:9b`.

## Evaluation outcome — 2026-08-27

**The bounded evaluation is complete and unsuccessful. Do not integrate or promote this prototype.** The source-only stage still fails short, unambiguous current-state cases with the existing model. Production routing and saved settings are unchanged.

Contract implementation has 38 passing unit tests and independent spec/quality approval. The harness scores raw returned text, owners and deadlines without the existing projection's owner inference, and checks every reference against the exact supplied spans. These are mechanical guarantees, not evidence of semantic success.

Fresh checkpoint verification: **228 unit files / 2,275 tests passed**, full TypeScript check passed, and scoped Biome passed. These checks cover mechanics; real-provider semantic acceptance remains failed.

| Controlled run, seed 41 | Result |
| --- | --- |
| Flat source-only reconciliation, existing request profile | 0/3 passed. A declined offer became an action; a withdrawn Friday delivery remained current; the holdout duplicated a request/promise and invented a settled decision. |
| Same requests with only JSON grammar removed | 0/3 passed. All three final response strings were byte-identical to baseline, ruling out a grammar-only fix in these cases. |
| Same flat prompt with Qwen's documented nonthinking general-task sampling profile | 0/3 passed. It improved the first action list, but the withdrawal case retained cancelled/offer actions with missing metadata and omitted migration; the holdout invented an action for the recipient and unsupported decisions. No saved sampling setting changed. |
| Plain-language source-only six-turn diagnostic | Correctly described Ava's withdrawal and Dana's qualified promise, but called Ben's unaccepted offer a conditional commitment. This did not establish a reliable semantic foundation for a subsequent serializer. |

The sampled profile was `temperature=0.7, top_p=0.8, top_k=20, min_p=0, presence_penalty=1.5, repeat_penalty=1` per the [official model documentation](https://huggingface.co/Qwen/Qwen3.5-9B). Baseline requests explicitly set temperature 0.1 and inherited other model defaults. Both used the same existing model, thinking disabled, a 16,384-token context, 2,048-token output budget, and original synthetic source. The user's main app was running again; no active provider connection was observed before starting, but these timings are not isolated performance measurements. Timing was not a release gate.

Reproducible raw outputs, configuration and grammar-comparison hashes are recorded in `tests/manual/fixtures/meetingNotesReconciliationEvaluation.json`; temporary request-interception experiments were removed from the harness. The independent review confirmed substantive action errors before regex scoring, not merely formatting failures. Classification of an explicit choice to leave work unassigned can be debatable; those ambiguous decisions are not needed to establish the clear action/withdrawal failures. A valid `conditional on` paraphrase also exposes a vocabulary limit in the existing guard; do not claim that every rejected item is semantically wrong.

Integration, all-case/multi-seed expansion, long-source tests and rendered editor acceptance are intentionally not run after this failed first gate. The next bounded decision is permission to evaluate another generation model/runtime on synthetic data without changing production defaults. More stages, prompt rules or automatic retries are not justified by the current evidence.

## 1. Small source-only contract

Files: `electron/llm/meetingNotesReconciliation.ts`, `tests/unit/meetingNotesReconciliation.test.ts`.

- [x] Write failing tests for `parseReconciledSource(raw, source)`: strict four arrays; facts/questions require text and exact sources; actions additionally require explicit nullable owner/due; decisions require explicit nullable owner. Reject invalid references, wrong types and unsupported action ownership/modality rather than deleting them. Assign IDs in code and preserve immutable source.
- [x] Implement only that contract and `reconciliationDraft(result)` for mechanical inspection/projection. Do not add provider routing or claim full semantic validation from structural checks.
- [x] Add `buildSourceReconciliationPrompt(sourceText)` with a short source-only task and flat schema. Resolve later withdrawals/replacements before listing current actions; distinguish accepted promises (including qualified promises) from unaccepted offers, requests and completed work. Preserve material personal, interview and brainstorming discussion without manufacturing tasks. Unknown owners/deadlines remain null.
- [x] Verify RED then GREEN with `pnpm exec vitest run tests/unit/meetingNotesReconciliation.test.ts`; obtain independent reviews.

## 2. Independent real-provider gate

Files: `tests/manual/meetingNotesReconciliationAcceptance.test.ts`; reuse `tests/manual/fixtures/meetingNotesEditorCases.ts` without relaxing its assertions.

- [x] Run the source-only stage with the actual configured provider transport, fixed seeds, exact-source wire codec, bounded output and abort, thinking disabled. No draft input or retries that hide failure; root ran only sequential tests. No production app stop was authorized or performed.
- [x] Start with conditional promise versus willingness and the six-turn withdrawal regression. Inspect raw output and the independently scored projection.
- [ ] If those pass, run all nine cases for seeds 41/42/43 and add an independent paraphrase/reversal case. Report per-case semantic failures, not only aggregate JSON validity.
- [x] If the focused stage fails repeatedly, record the bounded result and stop integration. No model switch or weaker acceptance is implied.

## 3. Composition and conservation (only after gate 2)

Files: existing notes prompts/pipeline/types, focused composition helper if needed, pipeline/provider unit suites.

- [ ] Write failing tests showing that composition cannot omit or change an action's owner, due date, prerequisite, evidence or identity; cannot manufacture new actions/decisions; and cannot silently drop a reconciled topic.
- [ ] Feed the reconciled material plus original evidence into composition; keep source labels outside visible text and terminology governed by the existing strict authorization helper. Preserve existing title/edit/history/publication boundaries.
- [ ] Promote the proven path with distinct version/cache identity and explicit request budgets only when unit and real-provider composition assertions pass. Keep persisted legacy reads compatible; remove unused experimental branches when replacing them.

## 4. Long-source and reliability gates

- [ ] Test early commitments superseded by late source, middle-of-source actions and duplicated overlap across hierarchy. Reconcile against original source, not lossy summaries; retain exact inherited identity/content unless source explicitly supersedes it.
- [ ] Test cancellation, malformed/truncated model output, bounded repair, revision races, cache isolation and failure preserving existing notes.
- [ ] Run fresh full unit suite, typecheck, scoped Biome, diff check, changelog check and independent review. Restore Electron SQLite ABI after Node testing.

## 5. Isolated app and local delivery

- [ ] Use the already authorized synthetic Electron profile only. Verify actual rendered publication/regeneration, preserved title, user-edit conflicts, retry/failure and navigation. No production DB mutation or app restart.
- [ ] Update #674, decisions and changelog with measured outcomes. Commit locally after verification; no merge or push. Report any unperformed gate explicitly.

Accuracy, quality and reliability are release gates; latency is a recorded metric. This plan supersedes the previous fixed two-pass restriction, not the source integrity or semantic acceptance criteria.
