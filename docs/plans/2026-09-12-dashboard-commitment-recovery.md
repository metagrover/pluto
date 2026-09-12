# Restore trustworthy dashboard commitments

Date: 2026-09-12
Status: Code implemented and locally verified; live-data attribution and any targeted recovery remain pending.
Source baseline inspected: `f2e84e80c`.

## Objective

Make newly extracted personal commitments reliably discoverable on the dashboard without reviving dismissed obligations, exposing other people's work as personal, or treating similar wording as proof of duplicate identity. Establish which failure affected recent meetings before claiming the incident resolved.

## Evidence and open questions

The September 8 changes `f1795361f` and `60856441f` added dashboard wording-based deduplication and ownership filtering. `f1795361f` also added an existing-meeting wording match during entity persistence.

Read-only synthetic replays of the current dashboard functions established:

- An item linked to the self person passes `isThirdPartyAction`, but a second assignee-text check in `buildDashboardCommitments` hides it when the text uses an unrecognized name variant. An exact recognized name displays it.
- A possible commitment with the same wording as a confirmed item is suppressed despite a different meeting and deadline. It displays when the older item is absent.
- Without loaded identity, an otherwise recognized personal name is treated as someone else and disappears.

The existing `actionCommitment` and `dashboardModel` suites passed all 99 tests during diagnosis. These tests do not establish correctness for the reproduced cases or actual recent meetings.

The incident's persisted cause is still unknown. Pluto was closed; a standalone diagnostic reader could not decrypt its database. This is an inspection limitation, not evidence of corruption. No decrypted database, meeting text, or credentials belong in this plan or Git.

Notes publication and commitment publication are separate stages. `electron/main.ts` publishes entities through secondary processing after value-signal and entity extraction, while `electron/meetingAnalysisRuns.ts` records secondary completion or failure. Published notes alone do not establish that commitments were saved.

## Behavioral contract

1. A valid explicit person assignment takes precedence over assignee wording. An assignment to another person remains excluded from personal commitments.
2. Use the existing name/alias rules only when explicit ownership is unavailable. Do not infer identity from calendar attendees, acoustic guesses, or arbitrary name similarity.
3. Failed identity loading is an unavailable state, distinct from a successfully loaded profile with no self identity. It must not masquerade as a trustworthy empty queue.
4. Commitment equivalence comes from canonical IDs and active, validated persisted aliases. Wording overlap alone cannot suppress, reuse, merge, complete, or dismiss an obligation.
5. Distinct or uncertain identities remain separate reviewable candidates, subject to ordinary ownership and lifecycle rules. Preserve existing confirmation, rejection, completion, snooze, provenance, and reversible alias semantics.
6. Existing queue limits remain. An item outside the visible three-item model budget must remain reachable by reviewing earlier candidates; do not relabel normal queue truncation as data loss.

## Phase 1 — Identify the affected stage

Use the running application's supported read paths, or a verified key-aware read-only connection. Do not initialize migrations, run startup recovery, or regenerate keys for inspection.

Inspect a bounded sample: recent meetings after September 8 and at least one earlier meeting with known visible commitments. Compare:

- Published analysis action counts and source references.
- Current analysis-run notes status, secondary status, stage, error category, and run/source revision.
- Saved action entities, meeting links, explicit ownership, review/status fields, and active aliases.
- Results from active/overdue/stale action queries and each subsequent dashboard filter.
- Identity-load state and final suggestion ordering/cap.

Produce a private, minimal per-candidate exclusion ledger: not extracted; secondary incomplete/failed; persisted/reused; aliased; other owner; identity unavailable; rejected/completed/snoozed; wording-suppressed; visible; or queued beyond the display budget. Keep reportable output to counts and sanitized references.

**Exit:** Account for each candidate in the sample and identify actual failure stages. If data access remains unavailable, proceed with independently reproduced code fixes, but keep incident attribution and recovery explicitly pending.

## Phase 2 — Unify dashboard ownership and identity availability

Files: `src/utils/actionCommitment.ts`, `src/components/features/dashboardModel.ts`, `src/components/features/useDashboardHome.ts`, and `src/components/features/Dashboard.tsx` as needed.

- Centralize precedence for explicit assignment and fallback names. Remove the contradictory second text-based decision in `buildDashboardCommitments`, or route it through the same authoritative predicate. Cover direct model-builder callers as well as `buildDashboardHomeModel`.
- Preserve exclusions for explicit third-party assignments even when metadata says `Me`.
- Represent identity loading success/failure explicitly instead of silently reducing a failure to `null`. Keep the identity dependency optional to unrelated dashboard surfaces.
- On first-load failure, show a compact commitments-unavailable message with Retry. On refresh failure, preserve the last successfully resolved commitment view with a clear stale/unavailable indication. Retry must reload identity and recompute the queue.
- Do not fall back to showing all named assignments when identity is unavailable. Keep a genuinely unconfigured profile distinct from transport failure, and retain its established behavior unless Phase 1 demonstrates a separate defect.

**Exit:** Explicit self assignments display consistently despite stale/variant text; third-party work stays excluded; identity failures are visible and recoverable without implying an empty queue.

## Phase 3 — Remove wording as a second identity authority

Files: `src/components/features/dashboardModel.ts`, `src/utils/actionCommitment.ts`, `electron/entityPipeline.ts`; inspect `electron/commitmentReconciliation.ts`, `electron/commitmentIdentity.ts`, and relevant `electron/db.ts` query/alias seams.

- Remove `areActionsEquivalent` as a dashboard suppression rule against confirmed, rejected, or other possible items. Deduplicate repeated query rows by canonical ID. Existing action queries already exclude active alias extractions; verify this across all three dashboard query paths before relying on it.
- Remove the fallback in `persistExtractedEntities` that reuses an existing meeting action based only on `areActionsEquivalent`. Retain stable extraction-ID resolution and matches explicitly produced by semantic reconciliation.
- Verify owner, deadline, source context, cancellation, queue revision, and source revision safeguards in the existing reconciliation path. Reuse these safeguards; introduce no new model calls in rendering.
- Preserve idempotency for exact repeated extraction. If removing the fallback exposes historical identity gaps, repair through validated aliases or targeted reconciliation rather than restoring lexical matching.
- Search remaining callers before deleting or changing the utility. Limit changes to commitment identity decisions; avoid unrelated phrasing cleanup.

**Exit:** Distinct obligations survive across meetings, deadlines, and scopes; validated duplicates remain collapsed; repeated extraction remains idempotent; failed or stale reconciliation leaves persistence unchanged.

## Phase 4 — Regression and integration coverage

Add focused tests before fixes, demonstrate failures, then make them pass.

| Seam | Required cases |
| --- | --- |
| Ownership/model | Explicit self with variant or contradictory name text; explicit other with `Me` text; known self aliases; unresolved owner; possible and confirmed items; direct builder and full home model |
| Dashboard identity loading | Initial failure; refresh failure retaining prior results; successful retry; successfully loaded but unconfigured identity; other dashboard sections continue loading |
| Commitment identity | Same wording with different deadlines or meetings; similar wording with distinct scope; same canonical row returned in multiple queries; validated aliases; rejection/completion affects only the correct identity |
| Persistence | Exact rerun is idempotent; similar distinct same-meeting obligations remain separate; semantic match preserves canonical ID and reviewed metadata; stale/cancelled/failed reconciliation commits nothing |
| Queue and UI | Restored candidate can be reviewed; accepting/dismissing advances the queue; candidates beyond the cap become reachable; no fresh-empty claim during identity failure |
| Secondary processing, if implicated | Published notes plus secondary failure; eligible targeted retry; source/run supersession; no duplicate publication or note overwrite |

Use existing suites: `actionCommitment.test.ts`, `dashboardModel.test.ts`, `useDashboardHome.test.ts`, `Dashboard.test.tsx`/`Dashboard.dom.test.tsx`, `entityPipelineIdempotency.test.ts`, `commitmentReconciliation.test.ts`, and `commitmentIdentity.test.ts`. Add `meetingAnalysisRuns.test.ts` coverage if Phase 1 requires secondary-processing changes.

Run focused suites for touched behavior, `pnpm exec tsc --noEmit`, and applicable lint checks. Report pre-existing failures separately. For SQLite ABI work, restore Electron compatibility with `pnpm run ensure:sqlite-abi` before app validation.

## Phase 5 — Recover only evidence-backed missing work

Execute after code verification and the Phase 1 ledger are available.

- Saved but hidden commitments: reload/reproject; no data rewrite.
- Notes contain actions but secondary processing failed: use the existing eligible secondary-only retry after verifying current source/run revisions. Preserve published notes and reviewed entities.
- Commitments collapsed by the persistence fallback: inspect original published actions and canonical records. Prepare a dry-run repair that adds only proven distinct obligations through the corrected path. Retain existing lifecycle decisions on their original identities.
- Active aliases: do not restore them wholesale. Revalidate only implicated matches and use existing reversible restoration APIs when evidence establishes they are wrong.
- Notes contain no action: treat as a separate extraction-quality finding. Do not invent commitments or silently regenerate all meetings.

Any necessary persistence repair must have an owner-only encrypted recovery snapshot, bounded target list, dry-run expected changes, transactional/current-revision guards, and a verified rollback procedure. Do not change unrelated meetings or schedule broad reprocessing.

## Acceptance and delivery

- Every sampled recent action has an explained outcome; every eligible personal canonical candidate is visible or reachable in the review queue.
- Reproduced ownership and deduplication regressions pass in the corrected full dashboard flow.
- A rendered app check confirms review, acceptance, dismissal, and identity-retry behavior. Prefer an isolated fixture profile for mutations; keep the user's live meeting validation read-only unless a targeted repair is authorized.
- No reviewed history, provenance, unrelated commitments, notes, transcripts, or recordings are lost or overwritten.
- Separate reports for code checks, private-data replay, rendered app evidence, and any remaining real-meeting acceptance. Do not call incident recovery complete while live-data validation is pending.

Implement in reviewable slices: ownership/loading; canonical identity/persistence; then any evidence-backed recovery. Preserve concurrent work. During implementation, compare the final behavior with `docs/decisions.md`; if replacing an accepted decision, add an entry naming it. This plan does not authorize a release, commit/push, or broad data repair.
