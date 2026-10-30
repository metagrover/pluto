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
| 34 | Integrated with current upstream, including Tasks, saved commitment-status recall, explicit response preferences, associated tests, and the historical MTP evaluation plan. |
| 80 | Retain newer upstream implementations and regression coverage for the same areas; original versions remain recoverable locally. |
| 2 | Earlier independent action-review implementation and its parser tests; superseded by the accepted notes-v87/v89 policy and retained in the local snapshot. |

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
- Saved personal commitment-status questions read canonical open, candidate,
  completed, and rejected state before generation, with ownership, confidentiality,
  source survival, and meeting-scope checks. Unfamiliar wording can require
  clarification. This lookup concerns meeting commitments; the Tasks list and
  explicit task commands cover manually captured work.
- Explicit length preferences for chat and preparation briefs are saved separately
  from facts, validated, replaceable, and removable. They guide wording without
  silently cutting off evidence or conditions.
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

- Full unit suite: 564 files, 8,128 tests passed.
- TypeScript: `pnpm exec tsc --noEmit` passed.
- Production bundles: `pnpm exec vite build` passed for renderer, main, and preload.
- Changed-code Biome checks and `git diff --check` passed.
- Fictional renderer workspace: Tasks list, source details, and shared project
  dropdown checked visually, including the compact layout. Shared dropdown
  selection, keyboard behavior, and draft preservation have DOM regressions.
- All 172 original files were content-hash checked against the preservation
  snapshot; the original main-checkout files and HEAD were unchanged.

Live configured-provider task planning, strict output word counts, signed
packaging, and physical capture were not acceptance-tested in this review.
