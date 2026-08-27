# Local Notes Guidance and Guardrails Implementation Plan

> **For agentic workers:** Use subagent-driven-development and TDD, with spec review before independent quality review. The user has approved the design and execution in this task.

**Goal:** Reduce local-model omissions and mistaken commitments using a compact content policy and targeted source checks.

**Architecture:** Share content guidance while retaining stage-specific JSON contracts. A pure guardrail module inspects original source and proposed drafts, then the existing audit/repair boundary enforces its findings. Preserve hierarchy conservation and existing failure-safe publication; do not add a routine model stage.

**Tech Stack:** TypeScript, Vitest, existing local Ollama provider and exact-source codec.

## Task 1: Compact shared guidance

Files: new `electron/llm/meetingNotesGuidance.ts`; prompt portions of `meetingNotesPrompts.ts`, `meetingNotesEditor.ts`, `meetingNotesReconciliation.ts`; corresponding prompt tests.

- [ ] Add failing tests for shared guidance appearing once per prompt, three labelled non-evidence examples, no dummy text values such as `fact` or `claim`, retained optional-win/terminology/source contracts and a bounded content-policy length.
- [ ] Run `pnpm exec vitest run tests/unit/meetingNotesPrompts.test.ts tests/unit/meetingNotesEditor.test.ts tests/unit/meetingNotesReconciliation.test.ts` and observe the new failures.
- [ ] Export `notesContentGuidance: string` and a concise textual `notesDraftSchema` shape definition. Reuse guidance from writer/audit/editor/merge/reconciler without repeated semantic paragraphs. Preserve all parser field requirements, stage identifiers and allowed-source rules. Examples use room booking, sending notes and cancellation, not evaluation names or objects.
- [ ] Re-run focused tests; update tests tied to superseded exact wording only when the equivalent contract is explicitly covered. Obtain spec then quality review.

## Task 2: Pure source guardrails

Files: new `electron/llm/meetingNotesGuardrails.ts` and `tests/unit/meetingNotesGuardrails.test.ts`.

Public contract:

```ts
import type { NotesDraft, NotesSource, SourceSpan } from './meetingNotesTypes';
export type NotesGuardrailIssue = {
  code: 'missing_action' | 'missing_condition' | 'conflicting_action';
  sources: SourceSpan[];
};
export function findNotesGuardrailIssues(
  source: NotesSource,
  draft: NotesDraft,
  allowedSpans?: readonly SourceSpan[],
): NotesGuardrailIssue[];
```

- [ ] TDD high-confidence first-person promises and accepted requests absent from action output; prerequisite omitted from the action; earlier promise retained after a supported withdrawal. Candidate/issue identification never mutates source or adds output claims.
- [ ] Add negative controls: can/could willingness, completed/reported/quoted promises, negated promises, unrelated cancellation, a qualified action already present, an explicit source-backed cancellation retained as a point, personal discussion, and evidence outside `allowedSpans`.
- [ ] Implement narrowly anchored candidate recognition and source-overlap checks, not a general semantic classifier. Require source linkage and content support for a cancellation/condition; arbitrary points citing everything cannot satisfy action recall. Return unique bounded diagnostics with exact original source references. Ambiguity is not permission to assign an owner or delete a task.
- [ ] Run `pnpm exec vitest run tests/unit/meetingNotesGuardrails.test.ts`; inspect counterexamples and complete spec/quality review before integration.

## Task 3: Repair and pipeline integration

Files: `meetingNotesPipeline.ts`, reconciliation parsing, focused pipeline/reconciliation/guardrail tests; relevant version/cache definitions if identity changes.

- [ ] Add failing pipeline tests: reviewer drops a valid promise; repair returns empty output; prerequisite absent; later withdrawal; source-based corrected retry succeeds; second invalid retry fails; no third attempt. Preserve already-grounded title/edit/history behavior.
- [ ] Use `findNotesGuardrailIssues` against the proposed final draft and applicable source window inside existing audit parsing. Raise `MeetingNotesError` with privacy-safe code/source diagnostics, not transcript prose. Apply the same check to source-only reconciliation parsing. Root/full-source checks must not silently allow leaf omissions; respect bounded original-source context.
- [ ] Keep existing hierarchy conservation; verify protected commitments cannot lose owner/due/condition during composition. Replace generic repair instructions permitting default deletion with targeted original-source correction, then revalidate. Preserve original request cancellation and existing one-repair budget.
- [ ] Run pipeline, audit, reconciliation, hierarchy, transport and provider-routing suites. Update generation/cache identity when needed to prevent stale prompt/check outputs being reused; retain legacy readers.

### Decision contract correction within task 3

Files: `analysisGrounding.ts`, `meetingNotesAudit.ts`, focused reconciliation/grounding tests.

The saved Rina decision cites a settled no-summary clause followed by an unrelated question in the same turn. Nora's explicit leave-unassigned clause lacks a recognized decision-owner cue. Add a decision-only path that identifies a target-supported explicit disposition clause and its speaking owner. Keep the full original spans; do not alter shared action willingness/request checks. Positive controls use the saved statements; negative controls include tentative/question formulations, arbitrary negated facts, unrelated targets borrowing a neighboring choice, wrong owners and lost conditions. Never broaden generic resolution vocabulary to bypass these checks globally.

## Task 4: Local verification and checkpoint

- [ ] Define the new explicit negative-decision contract in fresh fixture assertions before inference; keep prior raw outputs and historic gates unchanged. Add new task objects/names and paraphrases absent from prompt examples.
- [ ] Run sequential opt-in local-model cases using already-installed Gemma and Qwen only, thinking disabled initially. Record raw output separately from repair, request counts, exact model/configuration, latency and source-level accuracy. Do not run production meetings or change defaults. Expand if evidence justifies it; do not loop on one fixture until it happens to pass.
- [ ] Independently review actual output and final diff. Run full unit/DOM suite, typecheck, scoped Biome, diff and changelog checks. Restore Electron SQLite ABI after Node tests and verify an in-memory open.
- [ ] Update #674, decisions and the existing changelog fragment. Commit scoped work locally without merge/push. Report any remaining semantic or app-acceptance boundary explicitly.
