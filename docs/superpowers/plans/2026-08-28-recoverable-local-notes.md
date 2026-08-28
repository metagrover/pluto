# Recoverable Local Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish useful complete local notes with recorded quality warnings, exclude questionable commitments, and use Gemma for meeting notes.

**Architecture:** Preserve the existing writer/audit and single-repair flow. The second audit parse may recover recognized semantic diagnostics on the local production route, while schema/source/transport/cancellation/resource failures remain hard. Aggregate warnings across hierarchy and use shared Gemma identity for requests and run caching.

**Tech Stack:** TypeScript, Vitest, Electron, Ollama, SQLite.

---

## Task 1: Recoverable quality and model identity

**Files:** `electron/llm/meetingNotesAudit.ts`, `electron/llm/meetingNotesPipeline.ts`, `electron/llm/meetingNotesTypes.ts`, `electron/llm/analysisTypes.ts`, `src/types.ts`, `electron/llm/unifiedProvider.ts`, `electron/meetingAnalysisRuns.ts`; focused existing test files plus `tests/unit/meetingNotesAdvisory.test.ts` and `tests/unit/meetingNotesAdvisoryHierarchy.test.ts` as needed.

- [x] Add failing real-pipeline tests using existing fixtures, a source containing a conditional task, and two unchanged audit responses. Assert valid prose survives, the unverifiable task is absent from both topic and rollup task lists, quality warnings persist, and exactly three generation calls occur:

```ts
expect(result.all_action_items).toEqual([]);
expect(result.quality.format_pass).toBe(true);
expect(result.quality.fallback_used).toBe(false);
expect(result.quality.issues.length).toBeGreaterThan(0);
expect(result.generation_metadata?.audit_status).toBe('complete_with_warnings');
expect(generate).toHaveBeenCalledTimes(3);
```

- [x] Add failing tests for missing-action/cancellation-context warnings, source-detected conditional/conflicting actions, missing inherited commitments, warning propagation through a later clean merge, and publication of a complete warning-bearing result. Keep malformed JSON/schema, bad IDs/targets, missing verdicts, invalid/out-of-scope spans, cancellation, resource bounds and transport failures rejecting. Hosted and editor paths remain strict.
- [x] Run focused tests and record expected RED before code: `pnpm exec vitest run tests/unit/meetingNotesAdvisory.test.ts tests/unit/meetingNotesAdvisoryHierarchy.test.ts` (use only created files).
- [x] Add optional advisory-quality handling at the audit application boundary, keeping strict mode as default for direct helper callers. Validate the complete contract and all references before suppressing semantic errors. Remove invalid confirmed actions/decisions; never return an unchecked writer draft. On the existing repaired response only, the local pipeline enables that handling and records semantic guardrail/conservation warnings. Exclude action records independently found to conflict with source or omit prerequisites. Do not swallow arbitrary exceptions or broaden the retry budget.
- [x] Carry warnings from every leaf and merge into final `quality.issues` and `audit_status: 'complete_with_warnings'`; keep `fallback_used: false`. Do not overwrite diagnostics in `metadataFor`. Keep audited projection and complete-meeting publication intact.
- [x] Add one shared model constant and production version identity:

```ts
export const NOTES_OLLAMA_MODEL = 'gemma4:12b';
export const NOTES_PROMPT_VERSION = 'notes-v28';
```

- [x] For note generation select the shared Gemma constant before generic/legacy settings or auto-detection; pin it through writer, merge and audit. Use it in `configuredModel` for local note fingerprints. Leave non-note settings and hosted providers unchanged; do not write settings or pull models. Update intentionally changed cache/policy expectations.
- [x] Test without inference: old generic settings still request and record Gemma for notes; non-note calls retain their configured model; hosted models remain unchanged; missing Gemma cannot silently select another model.
- [x] Run focused notes/provider/coordinator tests, TypeScript and scoped Biome. Independently review specification compliance first, then code quality. Commit owned implementation after both reviews pass.

## Task 2: Saved-response and release verification

**Files:** Public captured fixtures remain immutable; private replay/report stay outside the repository. Update the existing #674 changelog fragment, `docs/decisions.md` and a current verification report.

- [x] Replay public saved direct responses through real parsing/audit/projection, including failed qualified publication. Check recovery removes disputed tasks without claiming omitted task wording was repaired.
- [x] Replay the three private stopped Gemma sequences byte-for-byte with inference disabled. Assert continuation to the next unrecorded stage after the former rejection. Label this continuation evidence only; never invent responses or claim complete real-meeting output.
- [x] Run `pnpm exec vitest run --maxWorkers=2`, `pnpm exec tsc --noEmit`, scoped Biome, `git diff --check`, `pnpm run build --publish never`.
- [x] Run `pnpm run package:verify-runtime`, `pnpm run audit:high`, and `pnpm run changelog:check`. Rebuild Node SQLite only when needed for the suite, then restore Electron using `pnpm run fix-sqlite-abi` and verify an Electron in-memory query.
- [ ] Confirm the clean owned worktree, unchanged private production records and untouched unrelated main work. Update PR/issue with the approved bar and exact evidence; deliver the reviewed baseline without another semantic perfection loop. Do not describe a worktree-only result as already running in the app.
