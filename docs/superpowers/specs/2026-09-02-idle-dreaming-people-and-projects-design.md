# Stable Background Consolidation for People and Projects

**Issue:** [#586](https://github.com/metagrover/pluto/issues/586)  
**Date:** 2026-09-02  
**Status:** Approved for implementation

## Outcome

Pluto prepares grounded improvements to People and Project dossiers while the Mac is idle without allowing model output to mutate trusted knowledge directly. Each run is bounded, tied to a durable source revision, fully preemptible, and reviewable in the affected dossier.

## Product boundary

- Background generation creates proposals only.
- Every proposed fact cites a supplied meeting ID and an exact normalized excerpt from structured meeting notes.
- Users accept or reject pending proposals. Acceptance uses the canonical People, Projects, commitment, milestone, or reversible-alias persistence path. Rejection records a durable negative constraint.
- Raw transcripts are not ordinary dreaming input and remain immutable.
- Identity merges, deletions, archival, ownership assignment, and temporal-state rewrites are not automatic.
- Gemma is the fixed model for this evidence-heavy synthesis. Phi remains available for lightweight foreground interactions. Qwen and cross-model evaluation are out of scope.

## Data model

### `entity_dreaming_runs`

One row represents evaluation of one entity at one source revision.

- `id`, `entity_id`, `entity_type`, `source_revision`
- `status`: `running`, `no_change`, `proposed`, `failed`, or `cancelled`
- `model`, `prompt_version`, `attempt_count`, `error_code`
- `lease_token`, `started_at`, `completed_at`, `next_retry_at`, `created_at`, `updated_at`
- Unique `(entity_id, source_revision)` prevents duplicate completed work.

The source revision is a SHA-256 digest of the canonical entity ID, the bounded ordered meeting IDs, the structured-note content used by the prompt, the current accepted dossier baseline, and current correction fingerprints. A new meeting, edited note, accepted proposal, or rejection produces a new revision without clearing work that arrived during a run.

### `entity_dreaming_proposals`

One row represents one reviewable claim.

- `id`, `run_id`, `entity_id`, `entity_type`, `kind`
- `payload_json`, `evidence_json`, `fingerprint`
- `status`: `pending`, `accepted`, `rejected`, or `stale`
- `decided_at`, `created_at`, `updated_at`
- Unique `(run_id, fingerprint)` prevents duplicate proposals within a run.

Proposal payloads contain display values only. Evidence contains supplied meeting IDs and excerpts. The model never supplies database identifiers other than meeting IDs already present in the input package.

## Input and output contract

The packager performs one bounded database read for the canonical entity family. It includes:

- current canonical display baseline;
- up to eight most recent linked meetings with non-empty structured notes;
- at most 1,600 words of structured notes across the package;
- current durable correction fingerprints;
- stable meeting IDs, titles, and dates.

The prompt instructs Gemma to return `no_change` or a list of independent proposals. Supported V0 proposal kinds are:

- `project_summary`
- `project_milestone`
- `project_commitment`
- `project_alias`
- `person_headline`
- `person_focus`
- `person_collaborator`
- `person_alias`

Every proposal has one or more evidence references. Each reference must name a supplied meeting and include a non-empty excerpt that matches its structured notes after conservative whitespace and punctuation normalization. Project summaries require evidence from two distinct meetings. Missing fields, unknown fields, unsupported kinds, unknown meeting IDs, unmatched excerpts, correction collisions, and malformed statuses reject the entire output before persistence.

`no_change` persists only the terminal run state and cannot create proposals or mutate canonical data.

## Proposal review and canonical application

Pending proposals appear in a compact “Prepared updates” section in the affected dossier. Each card shows the proposed value, its meeting sources, and Accept and Reject actions. The overview-level action is removed; “Prepare updates” is always scoped to the open entity.

Accept and reject are transactions guarded by proposal status and source revision:

- Project summaries update the existing project-theme synthesis structure while preserving cited source meetings.
- Project milestones use a generated, evidence-bearing milestone source distinct from user-created milestones.
- Commitments use the canonical commitment/entity-link path and never infer authoritative ownership.
- People headline, focus, and collaborator claims update the evidence-bearing knowledge-document structure read by the People dossier.
- Alias acceptance uses the existing reversible merge/alias workflow and displays the affected identity before confirmation. It never silently merges an existing entity.
- Rejection marks the proposal rejected and records its fingerprint as an entity correction in the same transaction.

If the entity source revision changes before a decision, the proposal becomes stale and cannot be applied.

## Scheduling and failure behavior

- Automatic work requires five minutes of system and renderer inactivity, wall power, safe thermals, and no foreground synthesis pause reason.
- The queue selects one dirty canonical entity at a time. Active project and person aliases are excluded.
- All generation shares Pluto's serialized inference gate. Foreground work preempts it.
- Each run has a three-minute deadline. Cancellation, timeout, malformed output, provider failure, or lease mismatch performs no proposal or canonical write.
- Failed revisions retry at most twice automatically with persisted exponential backoff. Manual retry does not erase failure history.
- The coordinator rechecks eligibility and lease ownership immediately before persisting proposals.
- Gemma is unloaded at the end of an idle batch or after preemption.
- Production logs contain identifiers only as local database keys and never include names, note text, excerpts, prompts, or output content.

## Quality gate

The release gate tests the exact production prompt and schema, not a test-only prompt. Deterministic fixtures cover supported claims, unsupported claims, fake excerpts, unknown meetings, corrections, stale revisions, duplicate proposals, cancellation, timeout, and partial database failure.

A production dogfood run may create pending proposals but does not accept them automatically. The release report records only content-free counts, validation outcomes, latency, cancellation, and whether every persisted proposal has resolvable evidence. There is no model comparison. Gemma remains the configured synthesis model.

## Delivery boundary

This branch removes the current direct reconciler and endless corpus loop. It ships only when:

- all model output is proposal-only;
- dirty revisions prevent repeated unchanged work;
- canonical application is transactional and evidence-preserving;
- corrections survive reload and prevent recurrence;
- foreground preemption, timeout, retry, and late-result rejection are tested;
- People and Project dossiers render and decide proposals correctly;
- focused tests, the full suite, lint, typecheck, changelog validation, diff checks, and production proposal dogfood pass.
