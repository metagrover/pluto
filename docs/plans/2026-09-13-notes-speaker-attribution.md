# Consistent, reversible speaker attribution in meeting notes

Status: core implementation completed on 2026-09-13; final live UI acceptance remains. The implementation follows this plan with one simplification: speaker references are derived deterministically from final source provenance and grammatical attribution uses, so the model wire contract and prompt version did not need to change.

Implemented in this slice: meeting-scoped local self projection, authoritative identity IPC, legacy generic-label repair, source-grounded reference metadata for new named prose and structured assignees/deciders, immediate renderer refresh, targeted and startup search refresh, projected Ask Pluto/knowledge evidence, and no notes regeneration for meetings that already have published notes. Historical proper-name prose without reference metadata remains unchanged when its identity cannot be recovered safely; explicit regeneration can add metadata.

## Intended result

Generated notes use the user's known meeting identity and confirmed remote speaker names. Confirming, correcting, renaming, or clearing a speaker updates attribution through code, without rewriting the meeting's substance or running notes generation again. Notes, copy/export, search, and meeting evidence supplied to Ask Pluto agree.

This is a notes-attribution change. It does not infer commitments, change commitment review or deduplication, change acoustic diarization, or make a roster entry proof of who spoke. Voice enrollment remains separate.

Synthetic acceptance example: a local meeting has self person Alex, canonical speakers `Me` and `Them`, and no actions. Existing generated prose says “Me's project is ready” and “Me is preparing a demonstration.” It should display Alex's name. Confirming `Them` as Jordan updates references to that speaker; correcting Jordan to Casey or undoing the confirmation updates those references without a model call. An unrelated mention of Jordan, an ordinary pronoun, or a user-written sentence must not change.

## Review evidence and existing implementation

Graph tools were unavailable in this session. This review used targeted source reads and caller searches; it does not claim graph coverage or an exhaustive repository audit. The affected generation, binding, document, export, and principal retrieval paths below were inspected directly.

| Area | Existing implementation | Reuse / gap |
| --- | --- | --- |
| Capture identity | `electron/identityStore.ts`: `recordCapture` stores origin and capture-time self person; `getCapture` reads it. | Reuse. Do not add another self-identity store. |
| Confirmed bindings | `identityStore.setBinding` / `clearBinding` transact, check expected revision, bump revision, and enqueue identity reconciliation. `electron/identityHandlers.ts` persists confirmation and links the person to the meeting. | Reuse binding persistence, revision guards, canonical person resolution, and Undo. |
| Self attribution elsewhere | `electron/commitmentIdentity.ts:getMeetingIdentityContext` synthesizes a `Me` binding from capture/current self context, excluding imported capture. It also has explicit legacy unknown-origin and null-capture fallbacks, covered by tests. | Notes generation bypasses this behavior. Extract only the needed pure resolution policy; do not blindly call this DB-heavy commitment context builder or silently change commitment policy. |
| Generation name projection | `electron/db.ts:getMeetingNotesIdentityProjection` resolves persisted bindings and canonical people; `electron/meetingParticipantIdentity.ts:buildMeetingNotesIdentityProjection` checks speakers and binding revisions. | Correct for explicit remote names, but does not receive capture/profile context and cannot supply the missing self fallback. |
| Generation and publication | `electron/meetingAnalysisRuns.ts` passes names into both `createNotesSource` and `buildAnalysisTranscriptFromJson`. `createNotesSource` hashes projected names along with source text. `publishMeetingNotesIfCurrent` guards publication and preserves edits. | Reuse. An identity change can invalidate an active run; retain stale-publication protection even after removing automatic regeneration. |
| UI names | `src/components/features/meetingTranscriptPresentation.ts:extractSpeakerDisplayNames` uses bindings, then profile/current-self fallback. Transcript presentation adds `(You)` for `Me`. Both speaker confirmation controls notify `MeetingView` immediately. | Reuse the interaction. Replace independent fallback policy with the server's meeting-scoped projection. Current helper has no capture-origin check and can disagree with generation. |
| Existing prose replacement | `src/utils/meetingNotesDocument.ts:applySpeakerDisplayNamesToText` handles numbered speakers, limited `Them` subjects, and `Me` before colon/em dash. `toBlock` also resolves speaker/assignee fields and bypasses edited/human prose. | Extend conservatively for old notes. `Me's` and `Me is` are missed. Replacing an already generated proper name is not reversible or safe from this map alone. Evidence strings currently also pass through substitution; source quotations need a stricter boundary. |
| Stored provenance | `SupportedText` in `electron/llm/meetingNotesTypes.ts` and `generation_metadata.source_provenance` store block IDs and source spans. | Keep source spans. They identify supporting speech, not individual speaker references within generated prose. A cited speaker can mention someone else. |
| Export | `src/utils/meetingNotesExport.ts` consumes the document model; `MeetingView` supplies it and displayed transcript segments. | Reuse. Fixing shared projection should fix exported blocks without a second regex implementation. Meeting title and section headings need explicit coverage. |
| Notes retrieval | `electron/intelligence/meetingNotesEvidence.ts` calls `buildMeetingNotesDocument` without a display-name map. Its consumers include meeting Ask Pluto, query engine, and project discovery. | Thread the same resolved projection into these entry points. A UI-only fix leaves stored/retrieved prose stale. |
| Search | `electron/database/meetingSearchMaintenance.ts` builds `meeting_notes_fts` from evidence and `meetings_fts` partly from raw `enhanced_notes` / MID. | Refresh affected derived search fields using projected notes; preserve raw transcript indexing. Current row-count repair cannot detect a same-size stale identity projection. |
| Person/project synthesis | `electron/knowledgeSynthesis.ts:buildMeetingEvidence` extracts analysis/enhanced notes independently. | Feed projected analysis into this extraction and invalidate affected derived context. Do not assume the notes-evidence helper covers this path. |
| Deferred regeneration | `electron/main.ts:onBindingChange` supersedes notes, queues `identity-notes:<meetingId>`, and queues knowledge/voice work. The background branch calls `generateAndPublishMeetingNotes`. | Replace only the notes-regeneration side effect after the projection work is complete. Do not remove unrelated voice or commitment workers. |
| Identity cache freshness | `MeetingView` has a module-level map cached by meeting ID. Its load effect depends on meeting ID, validation timestamp, and reviewable-speaker count, and skips meetings without reviewable anonymous speakers. | Add revision-aware invalidation, including self-only meetings and changes made elsewhere. Binding callbacks alone do not cover renames, merges, or profile edits. |

The investigated meeting had a saved confirmed remote binding and a saved self person. Its saved notes source fingerprint matched the source projected with the remote name, while self remained `Me`. The direct helper reproduction preserved both malformed self constructions. Private meeting text and identifiers are intentionally omitted from this plan and repository fixtures.

## Design decisions

### One meeting-scoped identity projection

Create a small pure resolver shared by generation and presentation, with DB/IPC adapters supplying its inputs. Prefer a module under `src/utils/` so the pure logic does not import Electron or the database. Its output should include canonical speaker key, resolved person ID, display name, resolution origin, and a deterministic revision. Keep transcript identity and display text separate.

Resolution order:

1. An applicable explicit speaker binding wins, including an explicit unresolved/null binding. A null selection must not be immediately replaced by a fallback.
2. For `Me` in a known local capture, use the capture-time self person, resolved through the existing canonical-person family. If capture-time self was never recorded, allow the current configured self person as the existing local fallback; mark the origin of that resolution.
3. Do not take the current workspace self person for an imported recording. For unknown-origin legacy notes, leave `Me` unresolved unless there is an explicit binding or independently verified local-capture provenance. This is a deliberate notes/UI tightening; do not change commitment legacy behavior as an incidental refactor.
4. Remote names require applicable confirmed bindings. Preserve the existing source-revision checks, singleton eligibility, and suppression behavior. Calendar attendees and person-name resemblance do not establish a binding.
5. A missing/deleted person or stale source-derived binding leaves the label unresolved; do not substitute a different workspace person. Renaming the same captured person changes their display name; selecting a different workspace self person does not reassign a recording that has frozen identity.

The resolver should accept preloaded relevant people and bindings, avoiding repeated full person scans and global recovery reads per rendered block. The existing helper can remain an adapter during migration, but must not retain an independent profile-name override.

### Preserve source notes; project attribution

Keep `analysis_json`, its generated prose, source spans, and user edits as the generation record. Identity-only changes produce a derived view, not a new generated document or generation timestamp. Start each projection from original text, never from previously substituted text. This makes correction and Undo repeatable and prevents replacement chains.

Two kinds of attribution must remain distinct:

- A generated reference to a recorded speaker follows the current binding for that canonical speaker.
- A proper name mentioned in the conversation is content. It does not change merely because the speaker is renamed or rebound.

Block-level citations alone cannot distinguish these. A global `oldName → newName` replacement is therefore not a complete solution.

### Small speaker-reference metadata for new notes

Extend the existing supported-text/provenance contract rather than creating a second notes format or a new model stage. Add optional, versioned speaker-reference metadata keyed by stable block path/ID, covering text references and structured attribution fields.

Each persisted text reference records the original text hash, exact character range in final generated text, canonical speaker key, and grammatical form (`name` or `possessive`). The generation-time speaker/name snapshot is retained for validation and historical interpretation. A reference follows the canonical speaker binding, not permanently the person selected at generation time.

The existing writer/editor must explicitly distinguish speaker references from ordinary names. Prefer exact mention text plus occurrence in the wire contract, with code calculating offsets, rather than asking the model to count Unicode offsets. Validate bounded lengths, exact occurrence, known canonical speaker, nonoverlap, and source support; the existing audit must check attribution meaning. Merely finding that speaker in a cited segment is necessary context, not semantic proof that every name in the sentence denotes that speaker.

No extra inference call is added. Update both compact and full/hierarchical contracts: the compact parser currently rejects additional keys. Preserve or rebuild annotations whenever the editor changes text, the merger changes block identity, or terminology normalization changes wording. Materialize final offsets only after all deterministic prose transforms. Derived overview references must be composed from their contributing items or independently validated; do not copy offsets across concatenated text.

Use the same references for structured assignee/decider fields where available; do not change action entity ownership or commitment review state in this work. Plain strings remain valid for backward compatibility. Unknown/malformed annotations must never cause arbitrary substitutions. Drop the unsafe annotation, retain original text, and expose affected uncertain attribution through existing review conventions if needed. Do not silently claim full correction coverage for unannotated references.

This metadata is the minimum additional information needed for reliable correction of names already embedded in prose. It is not needed to fix the two simple legacy `Me` constructions.

### Conservative compatibility for existing notes

Retain a deterministic legacy path for AI-authored, unedited notes without reference metadata. Recognize a bounded set of unambiguous speaker-label constructions, including straight/curly possessives and sentence subjects such as `Me is`, plus existing numbered-speaker and attribution-label cases. Support punctuation and non-ASCII display names using exact-string replacement callbacks.

Do not globally replace `me` or `them`; do not replace a proper name from an old binding by guessing. Skip quoted/code spans, scratchpad text, human continuations, user-edited blocks, and literal source evidence. If quote boundaries or reference identity cannot be established, leave that occurrence unchanged. A source label alongside a quotation can change while the quotation itself remains exact.

Use neutral grammatical noun labels for unresolved annotated prose (for example, `Local speaker` / `Remote speaker 1`), so Undo does not manufacture `Me's` or `Them is`. Preserve established transcript-label presentation separately. Do not rewrite existing unrelated awkward sentences or turn plural/shared speech into an individual.

Legacy corrections are intentionally partial when attribution is not recoverable. Explicit user-requested regeneration can produce the richer metadata later; do not run a hidden backfill or pretend old proper-name references can all be reconstructed safely.

## Implementation sequence

### 1. Lock down resolution and legacy regression cases

Files: new pure resolver; `electron/meetingParticipantIdentity.ts`, `electron/db.ts`, `electron/identityHandlers.ts`, `src/api/identity.ts`, `src/components/features/meetingTranscriptPresentation.ts`, `src/utils/meetingNotesDocument.ts`.

- Add failing tests for known local self without a persisted `Me` binding; confirmed remote names; capture-time identity versus changed workspace self; imported/unknown origins; explicit unresolved binding; stale binding; merged/renamed/missing people.
- Return the authoritative projection and revision from meeting identity IPC. Reuse it in notes source construction and UI rather than inferring it again in the renderer.
- Add bounded legacy prose handling and tests for possessives, subject forms, quotes, ordinary pronouns, human edits, replacement names containing `$`/punctuation, and repeated projection.
- Keep current publication protection intact. Do not remove deferred regeneration yet.

Acceptance: both initial generation inputs and displayed legacy blocks resolve a local self consistently, while imported/ambiguous cases remain unresolved. Existing confirmation controls still advance once and preserve Undo.

### 2. Add durable speaker references to new generation

Files: `electron/llm/meetingNotesTypes.ts`, `meetingNotesPrompts.ts`, `meetingNotesEditor.ts`, `meetingNotesAudit.ts`, hierarchy/editor normalization paths, `src/types.ts`, and metadata parsing/validation in `src/utils/analysisDocument.ts` as needed.

- Add optional reference fields to the existing wire contracts and final generation metadata. Preserve the existing analysis schema compatibility; do not require a SQLite schema migration solely for optional JSON metadata.
- Preserve canonical speaker identity alongside projected names in generation context. Do not derive canonical speakers by reverse-looking-up a potentially duplicated display name.
- Validate references after writer/editor output; carry them through section merging, overview composition, audit changes, and terminology normalization. Bound reference counts and payload size.
- Add a shared pure projection operation for generated prose, structured attribution fields, and generated headings. Keep original text/path data available for editing and history.
- Bump the notes prompt/cache contract version when the generation contract changes. Cover direct, hierarchical, live precomputation/reuse, and editor paths so incompatible caches cannot masquerade as annotated output.

Acceptance: a generated named-speaker sentence can be rebound, renamed, and cleared without editing its original text; an ordinary mention of the same person remains unchanged. Citations still point to the same recorded words. Invalid annotations abstain safely. Existing grounding and commitment inheritance checks still pass.

### 3. Use the projection across notes consumers

Files: `src/utils/meetingNotesDocument.ts`, `MeetingView.tsx`, `meetingNotesExport.ts`, `electron/intelligence/meetingNotesEvidence.ts`, `meetingAskPluto.ts`, `queryEngine.ts`, `electron/database/meetingSearchMaintenance.ts`, relevant `electron/db.ts` wrappers, `electron/knowledgeSynthesis.ts`, and project-discovery entry points in `electron/main.ts`.

- Project overview, summaries, key points, questions, generated headings, and speaker/assignee displays through one helper. Preserve scratchpad, user continuations, user-modified meeting title, edits, completion flags, and review exclusions.
- Keep copy/export built from the projected document. Verify title/header paths, which are not all ordinary `toBlock` calls.
- Supply projection context to the notes evidence builder and independent knowledge-synthesis analysis extraction. Do not introduce a database import into pure renderer/shared modules.
- Index derived projected notes in both relevant FTS paths. Do not rewrite canonical transcript or use projected evidence to bypass existing eligibility/review filters.
- Pass the relevant identity revision into derived evidence/cache fingerprints, so person corrections cannot reuse stale evidence. Invalidate affected person/project context and retain current background synthesis scheduling; do not equate that independent worker with notes attribution.
- Add a persistent projection-version marker for search compatibility. Reindex older entries in bounded, resumable batches, with immediate targeted refresh for an edited/opened meeting. Existing count-only index repair is insufficient. Do not rewrite stored notes as a migration.

Acceptance: UI, copied Markdown, reopened meeting, name search, and Ask Pluto's selected evidence show the same supported attribution. Raw evidence quotations and user edits remain identical. Legacy fallback behavior is explicit and tested.

### 4. Make identity-only updates immediate and refresh caches

Files: identity handlers and main IPC callbacks; `MeetingView.tsx` and identity controls; person/profile mutation paths; a small targeted derived-refresh coordinator only if existing coordination cannot support bounded retries.

- Bind/clear response returns the new projection immediately. Cache by meeting plus projection revision, not meeting ID alone; load identity for self-only notes as well as reviewable remote-speaker views.
- Emit or reuse a narrow identity-change notification after binding, profile/self update, person rename, merge, and restore. Refresh affected open views and invalidate relevant derived caches. Do not introduce frequent polling or expose meeting content in events.
- Discover affected meetings through bindings/capture/person-family relationships; use bounded background work for multi-meeting renames. Include local null-self fallback dependents when workspace identity changes, without reassigning frozen captures.
- Refresh a meeting's search projection under a checked identity revision. Stale jobs discard/retry; persistence failure must leave recoverable work and must not roll back a valid speaker confirmation. A persistent dirty/revision marker is preferable to a memory-only job if needed for crash recovery.
- Continue superseding a notes run built against old identities. Cover the first-generation race explicitly: keep its stale result from publishing, and allow the interrupted content-generation request to resume/retry under its existing lifecycle. Do not strand a meeting with no notes and no remaining run. Identity-only edits to already published notes must not start another generation.

Acceptance: identity changes while notes are open, changes from another view, app reopen, and rapid successive corrections converge on the newest projection. A recording is not attributed to a newly selected workspace person when its capture has a different frozen self identity.

### 5. Remove identity-triggered notes regeneration

Files: `electron/main.ts` and relevant coordinator tests; `docs/decisions.md` during implementation.

- Remove enqueueing/handling `identity-notes:<meetingId>` as a request for full notes generation once steps 1–4 work.
- Preserve explicit regenerate, source-content processing, in-flight stale-publication cancellation, independent knowledge refresh, and voice enrollment work.
- Do not remove `identityStore.enqueue` / `identityReconciliation.ts` as part of this change. Those serve commitment identity maintenance and are not a notes-projection completion signal. Some existing maintenance can use a model; scope the zero-call assertion to notes attribution rather than claiming all background identity work is deterministic.
- Add an accepted decision superseding only the regeneration clause of “2026-09-12 - Defer notes regeneration after speaker confirmation.” Preserve immediate confirmation, coalescing where applicable, and voice-work constraints. Reconcile the later voice-capacity decision's reference to identity-triggered notes.

Acceptance: after a published meeting's speaker confirmation, correction, or Undo, notes-generation request count stays zero, generated timestamp and substantive notes remain unchanged, and projected attribution updates immediately.

### 6. Verify and deliver

Use synthetic tests in Git. Keep any existing-meeting acceptance inspection local and read-only until implementation explicitly requires a user-visible data action. No private transcript fixture or one-off meeting-ID repair should be committed.

| Test layer | Required cases |
| --- | --- |
| Resolver | Local self, frozen self, later-configured local self, unknown/imported origin, explicit null, missing people, current/stale bindings, duplicate names, canonical merge/restore. |
| Prose | `Me's`, curly apostrophe, `Me is`, numbered speakers, confirmed remote subject, multiple references, possessives, repeated projection, correction/Undo, literal name collision, quotations, code, ordinary pronouns, human edits and continuations. |
| Metadata/pipeline | Direct and hierarchical writer/editor parsing, exact reference validation, Unicode, invalid/overlapping spans, overview composition, terminology text changes, changed block hash, source revision mismatch, cache/version invalidation, no extra generation stage. |
| Persistence/IPC | Bind/clear response, rename/merge/self change invalidation, targeted index refresh, restart recovery, rapid update races, stale publication, unfinished first generation, preserved edits/history/provenance. |
| Consumers | Notes/heading rendering, export and copy, notes evidence, both search indexes, meeting Ask Pluto retrieval, independent person/project evidence, review-block exclusions. |
| Integration | Zero notes-generator calls for changes to a published meeting; no accidental commitment mutations; no voice enrollment caused solely by rendering notes. |
| Manual | Confirm/correct/Undo in an open meeting, navigate away/back, restart, export, search the corrected name, inspect Ask Pluto evidence; confirm ordinary app responsiveness during a multi-meeting rename. |

Fresh baseline run during review:

```sh
pnpm exec vitest run tests/unit/meetingParticipantIdentity.test.ts tests/unit/meetingTranscriptPresentation.test.ts tests/unit/meetingNotesDocument.test.ts tests/unit/meetingNotesExport.test.ts tests/unit/meetingNotesEvidence.test.ts
```

Result: 5 files, 69 tests passed. These are baseline checks, not evidence that the proposed behavior is implemented. The small helper reproduction from the diagnosis still leaves the two malformed self constructions unchanged.

After implementation, run the focused suites above plus new resolver/projection tests, identity IPC/DB tests, notes source/pipeline/schema/editor/hierarchy/cache tests, publication race tests, and affected search/knowledge tests. Then run `pnpm exec tsc --noEmit` and the required lint checks. Rebuild SQLite for Node only if needed by DB tests, and restore Electron ABI with `pnpm run ensure:sqlite-abi` before live verification. Report baseline failures separately rather than widening scope to unrelated repairs.

For responsiveness, measure binding IPC completion and event-loop delay while derived indexes refresh; compare with the baseline on the same fixture/device. No model/native wait belongs on the confirmation response path, and no unbounded full-history refresh belongs in the renderer/main synchronous path.

## Delivery boundaries and risks

- Steps 1–2 can land in reviewable pieces, but do not declare the full correction/Undo behavior complete before consumers and cache freshness are wired.
- The main implementation risk is reference preservation through existing prose transforms. Validate the small annotation contract with direct and hierarchical fixtures before broad integration; do not compensate for parsing failures with extra model passes or a general name-replacement heuristic.
- Historical notes lack enough information for perfect proper-name rebinding. Preserve uncertain references, disclose that compatibility limit, and allow explicit regeneration. The concrete generic-self bug can be repaired without regenerating the meeting.
- Projection metadata does not prove acoustic speaker accuracy. Unknown/shared audio remains unknown/shared, and a person merely mentioned in a sentence remains distinct from its speaker.
- This plan is a proposal. Update the accepted decision only when implementing the replacement; do not mark the old behavior superseded merely by saving this document.
