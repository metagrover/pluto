# Local enhancement preservation review

The review starts from current `master`, preserving its newer provider, capture,
transcription, storage, identity, and notes policies. The original main checkout
and a separate local snapshot remain intact. Recovery data and private reports
are not part of this PR.

## Inventory

All 172 original changed or untracked files are accounted for:

| Original files | Disposition |
| --- | --- |
| 56 | Already byte-identical to current upstream; do not duplicate their patches. |
| 40 | Integrated with current upstream, including Tasks, explicit response preferences, source-note action sync and legacy provenance guards, associated unit/acceptance coverage, and the historical MTP evaluation plan. |
| 74 | Retain newer upstream implementations and regression coverage for the same areas; original versions remain recoverable locally. |
| 2 | Earlier independent action-review implementation and its parser tests; superseded by the accepted notes-v87/v89/v100 policy and retained in the local snapshot. |

The complete file-by-file inventory is retained with the local backup. None of
the previously untracked standalone enhancements are dropped: every one is
upstream, integrated here, or the explicitly superseded action reviewer above.

## Value brought forward

- A dedicated personal Tasks list shares the existing commitment lifecycle with
  dashboard, chat, and source notes. It includes capture, completion/reopening,
  optional projects, tags, descriptions, due dates, source navigation, search,
  filters, review/adoption, and daily Focus.
- Typed chat proposals confirm one exact task change through the shared service.
  Plain task creation, listing, and clear status commands work without a model;
  contextual planning uses bounded task context and the configured provider.
  Factual commitment-status questions continue to use the accepted `2026-10-26`
  canonical task evidence path rather than a separate lexical status shortcut.
- Source-note action synchronization preserves explicit completion across legacy
  string action arrays and case-only rewrites, requires matching structured
  owners when present so identical titles cannot transfer another owner's
  completion to a confirmed task, and allows unreviewed extracted suggestions to
  follow expanded source citations without moving explicit user ownership,
  review, or completion state.
- Legacy saved v3 notes carrying `writer-source-action-review-v1` remain
  recognized as source-grounded documents so missing provenance stays a conflict
  boundary during edit rebasing without re-enabling that historical pipeline.
- Explicit length preferences for chat and preparation briefs are saved separately
  from facts, validated, replaceable, and removable. They guide wording without
  silently cutting off evidence or conditions.
- Recovered unit and manual benchmark coverage includes pre-send local memory
  refusal and watchdog abort-reason propagation, cross-leaf notes cancellation
  and conflicting-action refusal checks, and the `commitment_state` fixture slice
  on the production-path acceptance harness.
- The failed native MTP evaluation plan keeps its measurements, quality criteria,
  and no-promotion boundary available for future research.

## Review corrections

- Refuse stale form writes rather than overwrite a change from another window.
  Refreshes preserve unsaved drafts and their original revision.
- Reject stale consolidated task IDs and source-title edits with unavailable
  source blocks. Keep notes, tags, and lifecycle changes transactional.
- Consume native task-change notifications in both Tasks and dashboard.
- Keep confidential/unavailable meeting tasks and private prior-answer context
  out of contextual provider planning; reject excluded IDs in returned proposals.
- Clarify empty task targets and ambiguous ownership instead of selecting a task.
- Use the existing shared searchable dropdowns for project filters, due-date
  filters, task projects, and tag merging, preserving keyboard behavior and themes.
- Apply a saved length preference without also supplying a conflicting default cap.

## Boundaries

This is an integration PR, not a release or a claim of live semantic acceptance.
No production profile is read or rewritten. Model defaults, native runtimes,
recordings, transcript provenance, memory admission, and current notes policies
come from upstream. The original local checkout is not reset or cleaned.

## Fresh validation

- Full unit suite: 564 files, 8,120 tests passed.
- TypeScript: `pnpm exec tsc --noEmit` passed.
- Production bundles: `pnpm exec vite build` passed for renderer, main, and preload.
- Repository checks: `pnpm run lint`, `pnpm exec biome check`, `pnpm run db:verify`,
  `pnpm run test:installer`, `pnpm run test:release-workflow`, and `git diff --check`
  passed.
- Disposable database & live acceptance harness check: `resolveMeetingAnalysis`,
  `getAnalysisEditBlocks`, and `syncMeetingActionEntitiesFromUserEdits` verified on
  a disposable copy of 78 persisted meetings (3,398 edit blocks, 149 action items)
  without mutating user data; `commitment_state` production-path harness verified
  against local Ollama `gemma4:12b` (`notes-v100`, `writer-only-v1`).
- Fictional renderer workspace: Tasks list, source details, and shared project
  dropdown checked visually, including the compact layout. Shared dropdown
  selection, keyboard behavior, and draft preservation have DOM regressions.
- All 172 original files were content-hash checked against the preservation
  snapshot; the original main-checkout files and HEAD were unchanged.

Live configured-provider task planning, strict output word counts, signed
packaging, and physical capture were not acceptance-tested in this review.
