# Meeting notes: readable prose with preserved evidence

Status: Implementation complete; private real-meeting and paired performance validation remain pending.

## Outcome and scope

Prevent garbled transcript excerpts from appearing as finished meeting notes while retaining material information and existing performance bounds. This is a focused extension of the notes publication path, coordinated with [the capacity and performance plan](2026-09-12-notes-capacity-and-performance.md). It does not claim to solve transcription accuracy or whole-meeting reconciliation.

This planning change authorizes no production regeneration. Preserve existing recordings, canonical transcripts, generated-note history, user edits, identity evidence and concurrent repository changes. Keep private meeting text, names, identifiers and audio out of committed fixtures and reports.

## Evidence and corrections to the initial proposal

The prior read-only investigation found a published topic summary equal to two adjacent transcript segments near the end of the reported meeting. Its heading implied actions although the topic and meeting had no structured actions. The run used Gemma with the compact bounded pipeline: three writer calls, two editor calls and publication warnings for invalid review and exhausted optional-review budget. Total runtime was approximately 426 seconds, including 421 seconds attributed to model calls. These are observations from that run, not a fresh benchmark or a general latency distribution.

Current source confirms that bounded leaves are reviewed in source order after all writers complete. Optional reviews may fall back to deterministic checks. The editor prompt requests readable third-person prose, but the compact writer does not carry that same explicit requirement. Acceptance validates source references for all blocks, while stronger semantic checks concentrate on actions and decisions.

Revise the earlier diagnosis and remedy in four respects:

1. **The component that introduced the literal text is unresolved.** `acceptEditedNotes` can reclassify conditional willingness as a point and set its text to the raw evidence. The final stored document alone cannot distinguish writer copying from this deterministic transformation. Reproduce that boundary before assigning blame.
2. **ASR confidence is supporting evidence, not a rejection threshold.** A short-clip replay remained garbled and had lower aggregate confidence than the full track. Those scores cover different inputs and do not establish why recognition failed. Audio statistics and capture validation do not prove acoustic intelligibility. Human listening is still needed to establish the intended words; no speculative transcript correction belongs in this change.
3. **Heuristics cannot justify silent deletion.** Literal quotations, first-person speech, repetition and lowercase names can all be legitimate. The exploratory corpus scan detected this example only, but was tuned after seeing it and is not held-out precision evidence. A section titled “Next Steps” may legitimately discuss an unaccepted request or unresolved follow-up; zero structured actions does not itself make the section invalid.
4. **Final acceptance warnings are currently overwritten.** `runBoundedCompactNotes` assigns `accepted.issues = [...new Set(issues)]` after conservative acceptance. This can discard diagnostics for reclassified or removed commitments. Preserve both sets and verify their persistence; the current warnings cannot establish that no other transformations occurred.

Relevant implementation: `electron/llm/meetingNotesPipeline.ts`, `meetingNotesAudit.ts`, `meetingNotesPrompts.ts`, `meetingNotesEditor.ts`, `meetingNotesTypes.ts`, `analysisTypes.ts`, and the notes projection/persistence consumers.

## 1. Reproduce and define expected behavior

Build a synthetic regression with two adjacent garbled source segments, their exact descriptors, a clean neighboring point, and a misleading generic heading. Keep the real case in a protected local replay input only.

Exercise both possible origins: a writer already returning a literal point, and an action demoted to a point by conservative acceptance. Cover successful review, invalid review and skipped review. Assert the final visible projection, source references, item kind and quality metadata, not just JSON shape.

Inspect current application and installed-build provenance when reproducing the historical run. Record leaf review outcomes and validation categories without logging private prompts, responses or keys. Existing `notes_audit_invalid` can wrap semantic as well as schema failures; do not label it a schema failure without the original validation category.

Expected result: supported neighboring notes remain visible; uncertain content remains discoverable with its evidence; no unsupported commitment is created; generated uncertainty is visibly distinguished from polished prose; user edits are preserved.

## 2. Improve the existing writer and preserve diagnostics

Share a short prose instruction between writer and editor: use concise attributed third-person prose, preserve modality and material detail, and do not copy disfluencies into finished notes or guess missing meaning. Keep explicit quotations available when meaningful. Apply the guidance to compact and ordinary writers so fallback output has the same basic prose expectations as reviewed output.

Preserve conservative acceptance issues when combining leaf warnings. Retain block identity and source revision when reporting a transformation. Bump the shared prompt/pipeline cache version for changed generation behavior so stale drafts cannot bypass the new rules. Version changes must not trigger mass historical regeneration or additional automatic retry loops.

## 3. Detect suspect prose and preserve it as reviewable evidence

Add one pure, bounded classifier for generated prose. Resolve each block's existing cited spans through a source-index map; compare normalized text against their concatenation. Avoid scanning every transcript segment for each block. Initial matching should use exact or whitespace/punctuation-normalized copying; defer fuzzy similarity until measured evidence requires it.

Use copying together with multiple independent disfluency signals as a candidate for review. First-person wording, lowercase starts, citation overlap, a repeated word or a generic heading alone must not trigger suppression. Explicit attributed quotations and short technical statements require dedicated negative cases. Treat this classifier as triage, not semantic proof.

Run it after conservative transformations and after model editing, before deriving overview, summaries and public rollups. Preview projection must use equivalent qualification for complete suspect blocks without extra inference; incomplete streaming text remains a draft. Keep the canonical transcript and generation evidence immutable.

For flagged content, preserve the original generated text, block identity, source revision and spans in optional versioned review metadata. Show one compact, collapsed source-review row in the relevant topic, for example “Review unclear wording”, opening the cited transcript/audio context. Do not substitute an invented paraphrase or remove the whole section. Keep supported neighboring points intact; derive any summary/overview only from eligible prose. If all prose in a section requires review, retain a review row rather than falsely claiming complete coverage.

Validate and round-trip the optional metadata through parsers, database publication, history/restore and user-edit rebase. Link by canonical block identity and evidence, not only an array index that filtering can shift. Older records remain readable. User-authored content is exempt from automatic qualification, and explicit edits take precedence.

Carry the same distinction through export, search and downstream notes consumers: uncertain excerpts must not reappear as settled facts or accepted tasks. Export a concise uncertainty label with optional evidence, and keep the evidence accessible through the existing transcript path. Do not add a separate dashboard or review workflow.

Headings are a separate check: prompt the writer/editor to align the heading with retained content. Flag an action-implying heading combined with suspect prose, but do not mechanically delete or rename “Next Steps” solely because its action array is empty.

## 4. Keep review scheduling changes separate

The initial implementation adds no inference call, ASR pass, model switch, context expansion, deadline increase or background job. Retain current review ordering, six-call ceiling, writer recovery allowance and twelve-minute deadline.

Measure review coverage by leaf position. If the focused change still leaves unacceptable qualified material, evaluate prioritizing suspect leaves within existing review slots as a separate candidate. Reordering can cost other leaves their review and reduce commitment recall; it is not automatically a free improvement. A whole-meeting editor belongs to the capacity/reconciliation work and requires its own quality and timing evidence.

## 5. Acceptance gates

### Behavior and information retention

- Synthetic cases cover both copying origins and all review outcomes; warning unions survive persistence and reload.
- Test valid quotations, names, abbreviations, deliberate repetition, short utterances, multilingual content, multi-segment evidence, conditional offers, accepted actions, negation, owners, deadlines and late cancellation.
- No material content disappears without an accessible qualified reference; no new commitment is inferred. No valid held-out block is incorrectly qualified in the release sample. Report sample size and every exception rather than claiming universal precision.
- Evaluate prose readability and material fact/action/decision recall separately using a source checklist prepared before candidate scoring. A prettier document with missing work fails.
- Verify UI, preview, export, search, downstream consumption, history restore and user-edit precedence. Metadata alone is insufficient if consumers still present uncertain text as fact.
- Confirm the reported example is handled in private replay, including its clean neighboring content. Replay does not count as production publication or proof of the intended spoken words.

### Performance

- Deterministic replay of identical model responses adds zero physical requests and preserves call/deadline/recovery accounting. Test cancellation and superseded-source publication.
- Target classifier/projection overhead of at most 10 ms p95 on the measured local machine at the largest currently admitted source; report measured values, fixture size and memory behavior. This is a proposed acceptance target, not an existing result.
- Compare real model runs with identical source projection, terms, user notes, model identity and cache conditions. Separate warm/cold and interrupted runs. Prompt edits can affect token counts, partitioning and runtime despite adding no nominal call.
- Use at least 20 paired successful samples for latency reporting, retaining failures separately in the outcome denominator. Require no reproducible slowdown beyond baseline variance for total notes time or time to useful preview, and no added recording/foreground contention. If results are inconclusive, keep qualification observational until there is sufficient evidence to enable it.

## Delivery sequence

1. Add reproduction and merge acceptance diagnostics; verify focused regression coverage.
2. Add shared prose guidance and observational classifier; replay synthetic and private cases and freeze held-out criteria.
3. Add reversible qualification metadata and consistent presentation/consumer behavior once precision and retention gates pass.
4. Run focused notes, persistence, projection and consumer tests plus TypeScript checks. Run measured real-model evaluation separately from builds/tests.
5. Present the implementation diff and paired quality/performance results. Record the accepted decision only when behavior is approved and measured. Existing notes remain unchanged until explicit regeneration; when regeneration is requested, verify the app's persisted result and edit/history preservation.

Rollback disables automatic qualification for new generations and restores the prior prompt version while retaining review metadata and original evidence. The release is complete only when readable output, information retention and measured performance pass together.
