# Semantic commitment reconciliation — #679

Approved in conversation: compare obligations by meaning before publication, preserve review history, and reversibly retire existing pending duplicates. Continue through implementation and verification without another routine approval gate.

## Contract

The configured provider compares incoming action items with prior pending, confirmed, dismissed, completed, and user-authored commitments. Meaning includes outcome, owner, deliverable, project and temporal scope; topic overlap is not equivalence. Cross-meeting references require evidence of the same obligation, not merely a recurring task. Uncertain matches remain separate. Invalid/incomplete responses or provider failures stop publication and remain retryable.

Use bounded JSON-schema requests with complete action descriptions, structured ownership/dates, and bounded source context. No lexical similarity threshold or embedding score decides identity. Exact persisted aliases may bypass repeat inference. Validate model IDs and prevent cycles. Serialize reconciliation/publication and check source/review snapshots before writes so concurrent regeneration or user edits cannot apply stale decisions.

## Persistence

Keep a canonical entity and persist alternate extraction identities as aliases. Preserve canonical metadata, user edits, completion, and review decisions. Existing pending extraction duplicates are retained as source records with reversible supersession metadata; never change their review state to pretend a human dismissed them. Exclude superseded records from active commitment queries and surfaces while preserving direct access, associations, and provenance. Never retire reviewed or user-authored records. Provide an explicit restore operation.

## Integration and recovery

Reconcile in the common entity publication boundary, including the durable notes secondary path. Notes publication remains independent of a semantic comparison failure. Use the existing provider, cancellation and serialized local generation machinery. Existing queue cleanup uses the identical semantic comparator and guarded persistence, with progress and a resumable/retryable result; do not regenerate notes to clean the queue.

## Verification

Test paraphrases, exact retries, dismissed/confirmed/completed preservation, distinct owners/deadlines/deliverables, same-batch duplicates, cross-meeting recurrence, malformed IDs/output, cancellation, stale snapshots, reversible cleanup and hidden aliases. Separately run the configured local model on a neutral semantic fixture set and on the pending queue before applying cleanup. Keep private meeting content out of GitHub and committed fixtures. No UI redesign or unrelated Projects changes.
