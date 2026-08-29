# General identity resolution for commitments

Issue: [#679](https://github.com/metagrover/pluto/issues/679)

Status: Approved for implementation and shipping. The approved `2026-08-28-about-you-design.md` extends the self-identification UX with optional onboarding and declared alternate names. Verification results are recorded separately; this status does not claim semantic acceptance or a deployed release.

## Outcome

For any Pluto user, resolve source-grounded commitment ownership to stable person identities before comparing obligations. Regenerated notes must not create duplicate suggestions merely because an owner is named differently. Identity corrections must automatically trigger safe re-evaluation of affected suggestions, without maintenance scripts or repeated manual cleanup.

There are no hardcoded people, personal relationships, organizations, or special cases for the developer. Team membership, reporting lines, and similar names are not identity evidence.

## Original boundary (before this change)

`electron/db.ts` already provides person entity IDs and action `assigned_to` references. `electron/commitmentReconciliation.ts` currently converts those references back to names. `electron/commitmentSemanticReview.ts` requires equal nonempty owner labels before semantic comparison. That prevents unsafe cross-owner merges but cannot resolve legitimate aliases.

Transcript segments carry speaker labels. The older `getSpeakerIdentityPrompt` / `extractSpeakerIdentity` path returns a guessed first name for the other speaker, without a durable source-backed binding. It is not sufficient for this feature and will not become the authority for identity.

The existing reversible commitment aliases, publication serialization, source/review revision guards, and provider cancellation boundaries remain the foundation. This feature extends them rather than introducing a second deduplication system.

## Scope and alternatives

Use evidence-backed identity records plus bounded model-assisted interpretation. A name-replacement dictionary is insufficient because speaker labels are meeting-local and recordings may be imported. Unrestricted model-generated person merges are unsafe because names and conversational context can be ambiguous.

The first release includes self identification, meeting speaker corrections, source-grounded action ownership, production pipeline integration, and automatic background reconciliation. It does not include voiceprints, new account authentication, calendar/contact integrations, a general person-merging product, or a People-page redesign.

The current local database is the workspace boundary. Independent databases must not share identity state. This does not add multi-tenant authentication to Pluto.

## Identity and evidence contract

### Workspace self identity

Persist an optional self-person reference to an existing or newly created person entity. Provide a small optional Settings control to select or create the current user's person record, and to change or clear it. Names are display values, not keys. Creating a person must allow distinct people with identical names.

Setting a name is explicit user confirmation of the selected identity, not an automatic assertion that every same-name entity is the same person. Never derive this setting from the operating-system username, repository metadata, a person mentioned in a meeting, or this coding conversation.

Identity resolution remains useful before self identification: meeting-scoped evidence can establish people and speakers without a global self binding. Where no evidence exists, an unknown result is correct. A one-time optional confirmation supplies information the app cannot reliably infer.

### Capture provenance and meeting speaker bindings

Persist recording origin as local capture, imported, or unknown. For new local recordings, snapshot the configured self-person ID at capture start. Later changes to the workspace self identity must not silently reassign earlier meetings. Legacy recordings start with unknown identity provenance unless independently established; filenames, channel labels, and the existence of an audio file are insufficient to identify a person.

A speaker binding associates a meeting-local speaker reference with a person ID, its evidence, and a revision. Generic labels such as `Me`, `You`, `Them`, and `Speaker 2` are never workspace-wide aliases. In imported or unknown recordings, `Me` cannot inherit the app user's identity. A collective or mixed remote channel cannot be bound to a single person without sufficient turn-level evidence or an explicit correction establishing the scope.

Capture origin alone does not prove every microphone utterance belongs to the user. Speaker-attribution reliability must be checked separately. Channel fallback, overlapping speakers, shared microphones, and uncertain separation cannot establish a confident person binding on their own.

### Provenance and corrections

Each accepted binding records person ID, meeting/speaker or named-mention scope, source kind, source revision, and evidence references. Source kinds distinguish explicit user corrections, capture-backed self attribution, and source-supported inference. Inferred evidence includes actual transcript segment references and verbatim quotes; a regenerated summary or another inferred action cannot supply circular corroboration.

Resolution has explicit resolved, unresolved, and conflicting outcomes. Model confidence is not itself evidence. Invalid references, absent quotes, conflicting speakers, ambiguous same-name people, and truncated relevant context prevent resolution.

Explicit corrections take priority over inference, are retained across regeneration, and are reversible. A meeting correction does not silently become a global alias. Do not destructively merge existing person entities; retain stable IDs and scoped bindings. Existing person links created by name similarity are not automatically promoted to verified identity.

## Source-grounded action ownership

Resolve the action's owner separately from the identity of the speaker who mentions it:

- First-person commitments use the identity of the actual evidence turn's speaker.
- Named assignments require evidence that the named person owns the obligation; merely mentioning someone or requesting work does not establish their commitment.
- Collective ownership remains collective rather than becoming the current user or an arbitrary teammate. The first release does not alias collective actions to individual actions.
- Pronouns require an unambiguous referent within the source context; otherwise ownership remains unresolved.
- Explicit user-assigned ownership is authoritative and is not overwritten by regeneration or source inference.

Two generated records that disagree about ownership require source review, not a person alias. Store an inferred ownership correction as a reversible derived resolution while preserving the original action text and extracted owner. Never resolve an ownership conflict merely because action descriptions are similar. Reviewed records with an explicit owner correction cannot be automatically reassigned.

The resolver exposes a person ID only when the evidence satisfies these rules. For unbound but reliable individual speakers, a meeting-local speaker identity can establish sameness within that meeting; generic aggregate channels cannot. No meeting-local identity can imply continuity across meetings.

## Model-assisted resolution

Use the configured provider and existing structured-generation facilities. Give it actual transcript evidence with neighboring turns, meeting-local speaker references, candidate person IDs, and already-confirmed bindings. Limit source windows and candidate sets; if adequate evidence cannot fit, return unresolved rather than guessing from a clipped excerpt.

The model proposes only identities from supplied candidates or an unresolved/conflicting result. It must cite evidence and distinguish a self-introduction, named assignment, first-person commitment, and ambiguous reference. Code validates schema, referenced IDs, meeting scope, source revision, and quote existence. A separate verification pass checks inferred equivalence/ownership against the source rather than relying on the proposal's explanation. Structural validation alone is not semantic validation; real-model acceptance cases are mandatory.

Explicitly confirmed mappings can resolve deterministically without model inference. Provider failure, cancellation, invalid output, and stale source state must remain retryable and must not silently fall back to label matching. Persist successfully reviewed source-scoped resolutions so unchanged regeneration does not repeat the same inference.

## Pipeline integration

The shared order is: obtain extraction and original source evidence; resolve speakers and action ownership; compare obligations against prior pending and reviewed commitments; publish through the existing guarded transaction.

Keep display names and raw extracted labels alongside resolved identity. Replace the current owner-label eligibility check with validated identity equality, while retaining action, outcome, deadline, project, and occurrence checks. Different resolved person IDs are distinct owners even when names match. Equal person IDs only make actions eligible for semantic comparison; they do not by themselves establish duplicate commitments.

Apply this boundary to modern analysis, regeneration, direct extraction, legacy secondary processing, and existing-queue review. Identity bindings and their revisions participate in the commitment publication revision guard. No production caller may bypass identity resolution through an optional-generator fallback.

Unresolved ownership is not an infrastructure failure. Preserve the suggestion separately with its uncertainty and source evidence; do not automatically hide, merge, or pretend the user dismissed it. A confirmed individual speaker identity can support same-meeting comparison even before its real-world name is known.

## Automatic reconciliation and recovery

Enqueue durable reconciliation when source identity evidence changes, a speaker/person correction is saved, an action owner is explicitly corrected, or a new analysis is published. Coalesce work by affected meeting and identity revision. At upgrade, enqueue existing pending extraction suggestions once; do not automatically backfill self attribution from the current profile into legacy recordings.

Run incrementally in the existing background execution system with one bounded source/candidate unit per checkpoint. Resume after restart, honor cancellation and interactive work priority, and record processed revisions. A newer identity/source/user-edit revision supersedes older work. Retry transient provider errors with bounded attempts and persisted retryable state; deterministic unresolved results wait for new evidence instead of looping.

Use the existing serialization and transaction checks for alias publication. Preserve confirmed, dismissed, completed, snoozed, and user-authored records. Only confidently redundant pending extraction suggestions may be retired through reversible aliases. Retain original entities, owner labels, evidence, links, and all human decisions.

Alias records must retain the identity evidence/revision on which they relied. If that evidence is revoked or corrected, invalidate the affected derived resolution and re-evaluate the alias. Restore an unsupported system-created alias using the existing restoration rules without modifying the canonical reviewed record. Explicitly restored suggestions remain protected from automatic re-retirement.

Ordinary source and identity changes must drive this workflow automatically. A one-time manual database cleanup is not an acceptance substitute.

## Minimal user interaction

Use the approved optional About you onboarding screen and shared Settings profile, with advanced existing-person selection, plus a meeting-scoped speaker correction action within the existing meeting surface. Include same-name disambiguation and a clear scope explanation; do not require every participant to be labelled. Corrections take effect in affected derived results without regenerating the raw transcript or rewriting transcript speaker evidence. Names and declared alternate names are person-scoped candidate data, not proof of who spoke. Work/study context is stored separately for a later terminology feature.

The background pass must expose truthful progress and retryable failure through existing processing/status patterns. Unresolved ownership stays visible as unresolved. The primary outcome is less repeated cleanup, not a new mandatory review queue.

## Implementation boundaries

Add focused identity types/resolver and persistence modules rather than putting model interpretation into the database module. Keep storage migrations and shared transaction/revision integration in `electron/db.ts`. Add background reconciliation orchestration separately from the pure resolver.

Integrate with `electron/entityPipeline.ts`, `electron/commitmentReconciliation.ts`, `electron/commitmentSemanticReview.ts`, provider structured generation, meeting analysis orchestration, and IPC. Capture provenance must originate at the recording/import boundary rather than being fabricated by the semantic model. Renderer/API changes are limited to self selection, meeting corrections, and truthful status.

Preserve unrelated dirty Projects work. Do not change recording/transcription algorithms, model selection, or the global visual design for this feature.

## Acceptance and verification

Write failing deterministic tests before production logic. Use neutral synthetic people and at least two independent database/workspace fixtures.

Required cases:

1. Confirmed aliases resolve to one person ID, regardless of display wording; another participant remains distinct.
2. Two people with the same name do not collapse; team membership and shared role do not establish equivalence.
3. Independent workspaces use their own self identities, with no shared singleton or leaked mapping.
4. Capture-time self identity survives later profile changes; unknown/legacy/imported `Me` does not inherit the current profile.
5. Mixed remote channels and unreliable speaker attribution remain unresolved; reliable individual speaker bindings stay meeting-local.
6. First-person, third-person, collective, quoted, and ambiguous statements produce the correct ownership or abstention.
7. Incorrect extracted owners are corrected only from source evidence, without changing original labels or explicit user assignments.
8. Repeated regeneration consults resolved history and does not resurface the same confirmed or dismissed obligation.
9. Different deadlines, deliverables, owners, and recurring occurrences remain distinct despite shared identity or wording.
10. Saving a correction schedules automatic reconciliation; restart resumes it, repeated triggers coalesce, and stale work cannot publish.
11. Provider failure, cancellation, malformed IDs, unsupported quotes, and incomplete evidence never cause an unsafe merge or silent bypass.
12. Revoking identity evidence restores unsupported system aliases without changing canonical human decisions or erasing provenance.
13. Explicit restore remains respected, and all production extraction paths enforce the same resolver boundary.

Separately run the configured local model on frozen neutral source-grounded cases, measuring wrong-person resolutions and incorrect merges as well as successful alias recognition. Passing schema checks or mocked-provider tests does not demonstrate identity accuracy. Validate the Settings and meeting correction controls in the rendered app, including save, clear, refresh, and background completion/failure. Do not claim a fresh real-meeting recording test when only fixtures or existing sources were used.

## Written-spec checkpoint

The user approved implementation, the About you extension, and merge/push to master. The TDD plans cover persistence migrations, correction APIs, background job lifecycle, onboarding/profile UX, and focused integration tests. Completion means the product performs automatic reconciliation through normal user actions, not merely that a resolver helper or maintenance script exists.
