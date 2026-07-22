# Recoverable Capture-Journal Seal Failure Design

**Issue:** [#535](https://github.com/metagrover/pluto/issues/535)

**Status:** Approved direction; awaiting written-spec review

## Outcome

Stopping a recording never makes the meeting disappear. Pluto preserves the capture journal and a visible meeting record even when durable journal sealing fails, while refusing to represent that meeting as normally finalized or fully trustworthy.

## Product Principle

Fail closed on trust, not on preservation. A missing meeting is a worse user outcome than an incomplete or imperfect transcript, but Pluto must not silently present unsealed evidence as a successful clean stop.

## Chosen Approach

Use a two-state finalization boundary:

1. A successful journal seal permits the existing transcript, canonical-audio, analysis, and meeting-save finalization path.
2. A failed journal seal persists a visible degraded meeting with status `recovery_required`, retains its unsealed capture journal, and prevents that record from claiming normal finalization.

The rejected alternatives are:

- Abort without persisting a meeting record. This protects trust semantics but makes captured work appear lost.
- Continue normal finalization with only a warning. This preserves visibility but lets an unsealed session look complete and trustworthy.
- Generate and present derived output as ordinary meeting data. This obscures the evidence failure and makes later correction difficult.

## Stop and Finalization Flow

1. Stop capture and settle all pending journal appends.
2. Request the journal seal before normal derived finalization begins.
3. If sealing succeeds, continue the existing finalization path without behavioral changes.
4. If sealing fails:
   - retain the unsealed journal and its mic/system evidence;
   - persist the minimum meeting identity and metadata needed to keep the meeting visible;
   - mark the meeting `recovery_required` through a durable, queryable state rather than overloading transcript text or a generic warning;
   - do not mark transcript, canonical audio, analysis, or meeting finalization successful;
   - surface the content-free message `Recording saved - processing needs recovery` through the existing recording status/error boundary.

The degraded save must be idempotent under repeated stop requests. It must not create duplicate meetings, discard journal evidence, or race normal finalization after a seal failure.

## Degraded Meeting Contract

The degraded record may contain only metadata already required to identify and display the meeting, plus a content-free recovery status and failure category. It must not copy raw audio, transcript text, participant identities beyond already-authorized meeting metadata, credentials, or filesystem paths into error fields.

The meeting remains visible in ordinary meeting navigation with a truthful incomplete state. Consumers that require finalized evidence must treat `recovery_required` as unavailable, not as an empty successful transcript.

No derived output created before the failure may be presented as finalized evidence. If existing stop orchestration has already produced temporary work, that work remains internal and retryable until the journal is sealed and recovery completes.

## Recovery Boundary

This issue establishes durable preservation and truthful status. Automatic retry, launch recovery orchestration, retention policy, and a full recovery-management UI are follow-up work. The implementation should expose one narrow recovery state that those paths can consume without redesigning the meeting model again.

Until recovery exists, the user can see that the meeting was saved and needs processing recovery. Pluto must not offer a destructive dismissal that deletes the only recovery source.

## Error Handling

- Journal append failure remains distinct from seal failure.
- Seal failure records a stable content-free failure category for diagnostics and retry routing.
- Failure to persist the degraded meeting must leave the journal untouched and report a separate local persistence error.
- A later retry may transition `recovery_required` to the normal finalized state only after sealing succeeds and derived finalization completes.
- Logs and UI errors must not expose meeting content, paths, identities, or credentials.

## Testing

Focused red-green tests will prove:

- pending appends settle before sealing;
- successful sealing preserves current finalization behavior;
- seal failure retains the journal and persists exactly one visible `recovery_required` meeting;
- seal failure cannot produce a normally finalized meeting;
- transcript, canonical-audio, analysis, and finalized-save success are not claimed before sealing;
- repeated or concurrent stop requests remain single-flight and idempotent;
- degraded-state messages and stored failure fields are content-free;
- consumers requiring finalized evidence reject or defer a recovery-required meeting.

Broader verification will include the existing capture-journal and recording-finalization suites, `pnpm run changelog:check`, `pnpm run lint`, `pnpm run test -- --run`, `pnpm run audit:high`, and `git diff --check`.

## Scope

In scope:

- seal-before-normal-finalization ordering;
- durable visible degraded-meeting state;
- preservation of unsealed recovery evidence;
- privacy-safe user status and error categorization;
- idempotent stop behavior.

Out of scope:

- automatic launch recovery and retry scheduling;
- recovery-history UI or manual recovery controls;
- retention-policy changes;
- transcript model or retry-policy changes;
- capture-journal schema changes;
- broad `AudioManager` refactoring.

## Documentation and Shipping

The implementation PR will update the durable recording-trust decision in `docs/decisions.md` and add an issue-scoped changelog fragment under `docs/changelog/entries/`. A separate ADR is unnecessary unless implementation reveals a long-lived storage architecture choice with credible alternatives.
