# Meeting reliability and recovery

Status: Implementation underway. No saved meeting has been regenerated.

## Implementation progress

- Speaker excerpt playback now has a policy separate from voice-enrollment evidence. Local microphone overlap does not contaminate the participant recording, but it still prevents aggregate `Them` speech from qualifying for enrollment.
- The renderer asks the backend whether a transcript-backed excerpt exists instead of enabling playback from a path string alone. Aggregate-channel audio is presented as a recording excerpt rather than an isolated voice sample.
- Sample loading returns stable failure reasons for missing sources, absent excerpts, encryption access, decoding, empty audio, oversized output, and cancellation. Local diagnostics retain the reason without recording transcript content or file paths.
- The sample read uses a meeting-scoped database query and does not run the global retry-recovery sweep. Candidate playback rejects effectively silent decoded ranges and searches a bounded set for an audible excerpt.
- The September 3 case is reproducible as a private regression: playback finds an audible eight-second System excerpt after skipping silent candidates, while enrollment remains unavailable. Application playback and a fresh-call acceptance run remain pending.

## Product outcome

Users can listen to available recordings, understand which meeting outputs are usable, and recover failed processing without losing their recordings, corrections, or confirmed identities. A failure in one capability must not unnecessarily disable another, and an available control must not promise an operation that known evidence rules out.

The September 3 noon meeting is a regression case for a broader failure class. Completion requires evidence across new meetings, existing meetings, and interrupted recovery; repairing that one meeting or changing its error text is insufficient.

## Starting evidence and open questions

Read-only diagnosis reproduced sample loading returning `null` before audio slicing: all 34 persisted `Them` segments overlap another speaker, so the shared clean-interval selector returns no intervals. The participant WAV exists and has a duration of approximately 2,253 seconds. The UI enables playback from the presence of a path, while the backend requires an eligible interval. The current persisted transcript reports `required_source_failed`, and attribution records `diarization_disabled`.

These facts establish a capability mismatch. They do not establish complete capture, audible speech quality, why transcription failed, or whether speaker separation was incorrectly skipped. Long overlapping transcript spans are not proof of simultaneous acoustic speech.

The separate [retry audio repair draft](2026-09-13-retry-audio-repair-routing.md) records more detailed journal findings, including a startup availability contradiction and PCM timeline shortfalls. Reconcile its `system_capture_incomplete` observation with the current `required_source_failed` state using artifact generations and stage evidence. Treat its earlier test results as historical, not validation of this work. Do not infer silence from padding or successful reconstruction.

Graph tools were unavailable during the initial investigation; source inspection was used. Refresh source and persisted evidence before implementation, especially where other reliability work has changed the same paths.

## Boundaries

- Preserve recordings, capture receipts, transcript provenance, user edits, and explicit identity confirmations and opt-outs.
- Reuse existing capture reconstruction, final transcription, coordination, publication, and enrollment boundaries. Introduce shared contracts only where current consumers disagree; do not create a second processing pipeline or independent trust database.
- Listening to audio, trusting transcript text, distinguishing speakers, suggesting a person, and enrolling a voice are separate decisions. No capability grants another by implication.
- Keep missing capture fail-closed. A successful decoder, checksum, full-length WAV, or retry request cannot certify complete capture.
- Keep ordinary recording and playback responsive. No full-history scan, ASR, or enrollment work in a playback or modal-open request.
- Historical regeneration is deliberate and reversible. No silent rewrite of old meetings, resurrection of deleted meetings, or automatic processing loop at startup.
- This plan does not change model routing or weaken source, identity, or enrollment quality thresholds.

## 1. Establish the failure classes and current ownership

Trace the UI, IPC, source selection, capture evidence, final transcription, speaker attribution, sample selection, enrollment, and persistence paths. Record where each state originates and which consumer interprets it. Inspect relevant cancellation, timeout, and stale-generation behavior rather than treating every `needs_attention` meeting as the same failure.

Use a bounded, local, read-only inventory of retained meetings to select representative cases: successful dual-source meetings, single-source meetings, failed source transcription, legacy coarse timestamps, real overlapping speech, absent/corrupt audio, and interrupted finalization. Start with metadata; inspect private audio and text only for selected cases. Report observed counts and limits without claiming population-wide prevalence.

For the reported case, determine whether failure originates in capture coverage, reconstruction, ASR, eligibility policy, or subsequent state propagation. Explain why diarization was disabled and whether that was correct for the available evidence. Account for timeline shortfalls using receipts and source timing; leave unverifiable intervals unresolved.

Deliverable: a concise failure matrix with confirmed causes, hypotheses, affected paths, recoverable inputs, and representative private fixtures. This determines the actual fixes in phase 3; do not commit to an algorithm change before its cause is established.

## 2. Align capability decisions and user actions

Define a small typed result at the existing service/IPC boundaries, derived from current source revision and evidence. Prefer extending existing result types over persisting redundant booleans. Map each consumer to that result so the meeting view, identity controls, and speaker modal do not invent availability from a path string.

| Capability | Required evidence | User experience when unavailable |
| --- | --- | --- |
| Listen to a recording | Readable source and a valid requested range | Explain missing, inaccessible, or unreadable audio; retain access to other available sources |
| Read transcript | Existing text, with its current trust state | Keep useful provisional or previous text visible and label uncertainty calmly |
| Generate source-grounded notes | Existing validated-transcript eligibility | Preserve existing notes; explain the prerequisite failure with one relevant recovery action |
| Listen to a speaker excerpt | Source-backed range and appropriate timing/label provenance | Offer ordinary recording playback where available; do not claim a speaker-specific sample if attribution is uncertain |
| Distinguish or suggest speakers | Existing attribution and matching evidence | Explain unsupported separation or suggestion without implying audio is missing |
| Enroll a voice | Existing clean-speech, identity, and provenance gates | Keep enrollment unavailable; ordinary listening remains independent |

Return actionable reason categories for absent excerpt, missing source, inaccessible encryption key, decoding failure, stale source, and cancelled work where those distinctions exist. Cancellation should not appear as a playback failure. Keep technical codes in diagnostics and translate them into concise product language.

Availability is advisory until execution: recheck the same source revision when loading audio and handle files or meeting state changing after the control renders. Avoid expensive eager decoding to decide whether to show a button.

For ambiguous audio, a recording excerpt may include multiple speakers only when presented as such, without inviting a confident identity assignment from that excerpt. Preserve strict enrollment rules. Do not simply remove overlap rejection from the shared clean-speech selector.

Deliverable: an agreed capability/action matrix and UI states, including ready, running, unavailable, and retryable failure, implemented through existing product patterns.

## 3. Fix the causes and connect reliable recovery

Apply the failure matrix to the existing processing boundaries:

1. Repair any confirmed source-state or timeline production defect that causes otherwise usable recordings to yield unusable transcript spans. Preserve source-relative word timing and provenance through projection and persistence. Verify normal cases as well as failed cases.
2. Connect explicit retry to the appropriate existing reconstruction/transcription/attribution path. Reuse the narrower retry draft where its evidence supports the route. Selecting reconstruction must not bypass capture trust checks.
3. Retry only the necessary stages when dependencies remain current; rebuild dependent outputs when their source revision changes. A failed prerequisite must produce an explicit reason for skipped downstream work.
4. Reassess sample selection after source and transcript repairs. Add playback-specific interval handling only where valid cases remain unsupported. Keep displayed excerpts aligned with the audio range actually returned.
5. Use the existing generation and compare-and-save guards for publication. Keep the previous result and user changes until the replacement passes required checks. Audit whether existing rollback and cleanup cover every newly connected path; close concrete gaps.

Recovery must survive cancellation, app restart, repeated clicks, and a newer run overtaking an older one. Deduplicate active work. Stale completion must not publish; cleanup must not remove original or newly owned artifacts. Do not rerun successful expensive work unless changed evidence requires it.

Respect existing automatic-work policies. Explicit recovery remains immediate subject to current recording/resource ownership; automatic retries require a recoverable condition, bounded attempts, and the existing idle/power admission where applicable. Permanent missing evidence must not produce repeated background work.

Deliverable: general fixes and one coherent recovery action whose outcome is either validated replacement outputs or an accurate explanation of what cannot be recovered.

## 4. Make failures diagnosable without exposing meeting content

Use existing diagnostics to retain stage, stable failure reason, source revision/generation, dependency skip reason, attempt outcome, and stage duration. Ensure sample failures retain their actual cause instead of collapsing all outcomes to `null`. Do not log transcript text, speaker names, audio, credentials, or private full paths.

Measure failure counts by stage, offered playback actions that fail, recovery success versus unrecoverable evidence, repeated attempts, and recovery time. Use local diagnostics initially; remote collection is a separate product/privacy decision. Avoid a new observability subsystem unless the investigation demonstrates existing diagnostics cannot support these questions.

## 5. Verify the full user experience

Build focused regressions at the actual boundaries, using synthetic or sanitized fixtures in Git and private real-meeting fixtures outside Git.

| Scenario | Required result |
| --- | --- |
| Healthy single-source and dual-source meetings | Existing successful processing and playback remain usable without added inference or full-file verification |
| Coarse overlapping transcript spans | No false claim of missing audio; honest playback options; no unsupported voice enrollment |
| Genuine overlap or uncertain remote identity | Ambiguity preserved in labels, excerpts, suggestions, and enrollment |
| Complete evidence with recoverable processing failure | Existing recovery path produces and persists validated outputs |
| Missing/corrupt chunks or unexplained timeline gaps | No fabricated silence or false validation; available evidence remains accessible |
| Legacy meeting or encrypted/key-unavailable source | Correct source handling and actionable failure without plaintext fallback |
| Cancellation, restart, repeat retry, concurrent edit, stale completion | No duplicate publication, lost user edits, identity overwrite, or deletion of originals |
| Existing notes and confirmed identities during repair | Preserved until appropriate replacement/reconciliation succeeds; opt-outs remain effective |

Run the relevant coordinator, persisted-finalization, capture recovery, speaker review/sample, enrollment, IPC/UI, and persistence regressions selected by the implementation diff. Run TypeScript and applicable lint checks. Restore the Electron SQLite ABI after Node testing when needed.

Perform private end-to-end replays on the reported meeting and contrasting successful/failing meetings. Listen to returned excerpts and compare transcript timing/attribution against source audio. Exercise the actual app action, then reopen the meeting to verify persistence and downstream eligibility. A fresh real call must verify capture through finalization and playback; replay alone is insufficient.

Record baseline and changed modal responsiveness, playback startup time, reconstruction time, and total recovery time on the same machine and fixtures. Set regression limits from those measurements before accepting performance-sensitive changes.

## Delivery and historical adoption

Implement in reviewable increments: evidence and contract; confirmed processing/recovery defects; playback/UI alignment; integrated acceptance and existing-meeting adoption. Each increment must preserve existing trust gates. A draft contract alone is not a reason for a broad refactor.

Before changing an accepted architecture decision, add a decision entry naming the specific prior decision and replacement. This draft itself supersedes no accepted decision. Coordinate with the existing transcript-reliability and retry-routing work rather than duplicating or overwriting it.

Apply successful-path fixes to subsequent processing. For old meetings, derive capabilities on access and offer deliberate recovery where eligible. If a historical migration is required, specify a versioned, restart-safe, reversible migration separately; do not infer new trust or speaker identities from old status flags. Rollback stops new recovery admission and retains readable prior artifacts and results.

## Definition of done

- Confirmed causes have general regression coverage, not meeting-ID-specific behavior.
- The same capability rules govern displayed actions and backend execution; races yield a precise recoverable state.
- Users can listen to available audio independently of transcript or enrollment eligibility, with uncertainty represented honestly.
- Recoverable failures complete safely; unrecoverable evidence remains clearly unresolved without retry loops.
- Original evidence, user edits, existing useful outputs, and identity constraints survive failed and successful recovery.
- Automated boundary checks, private replay, actual UI playback/persistence, and a fresh-call acceptance run have recorded results. Any missing gate remains explicitly pending.
- No material regression in recording responsiveness, normal playback, or resource use is accepted without a documented product decision.
