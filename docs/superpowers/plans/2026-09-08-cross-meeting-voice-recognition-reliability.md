# Cross-meeting voice recognition reliability

Status: proposed implementation plan. No application or production-data changes are made by this document.

## Outcome

Recognize recurring participants from explicitly confirmed local voice evidence across real meetings, expose qualified suggestions when the meeting opens, and improve sparse existing profiles without requiring users to start over. Apply the same policy to everyone.

Recognition in this scope means automatically finding and displaying a tentative match. A name becomes a confirmed meeting identity only through explicit user confirmation. Silent identity assignment would require a separate product decision and evaluation; it is not an implied consequence of improving recall.

## Evidence and open questions

Current source inspection establishes these constraints:

- `electron/speakerEnrollmentCandidate.ts:getSpeakerEnrollmentSource` requires exactly two intervals from `src/utils/speakerReview.ts:selectSpeakerSampleIntervals`. That playback selector also caps output at two, even if a larger limit is supplied. Increasing a caller's limit alone will not improve enrollment.
- `src/services/speakerCandidateEvidence.ts` accepts evidence with three seconds, two segments, two chunks, and minimum within-cluster similarity of 0.7. This is a purity/minimum-evidence check, not demonstrated cross-meeting reliability.
- `electron/speakerVoiceHandlers.ts:reconcileConfirmedSpeakerVoiceProfiles` skips a person once any profile exists. It therefore cannot strengthen an existing sparse profile from additional confirmed sources.
- `electron/speakerVoiceStore.ts:getCanonicalVoiceProfiles` forms one duration-weighted centroid. It groups rows by canonical person before checking compatibility and assigns the aggregate the provenance of one reference enrollment. Mixed extraction generations must not be blended under that label.
- `src/services/speakerVoiceMatcher.ts` requires absolute cosine similarity of 0.72 and a runner-up margin of 0.10. Abstention currently becomes a null result, making the cause unavailable to the UI.
- `scripts/benchmark_voice_calibration.ts:runCalibrationBenchmark` uses generated vectors. It verifies decision logic but cannot validate acoustic performance, channel robustness, or real-world thresholds.
- `src/components/features/MeetingView.tsx` now loads suggestions on meeting entry and displays tentative names. Its state must also track rejection, profile changes, and source changes, not only initial loading.

The reported failure established a valid query candidate and an active, compatible intended profile whose similarity did not pass the threshold. Sparse enrollment is a plausible contributor. Incorrect original speaker assignment, channel differences, and extraction inconsistencies remain alternative explanations until measured.

Private names, meeting IDs, dates, audio paths, excerpts, vectors, and per-person scores must stay out of committed fixtures, this plan, PRs, and published reports. Use opaque case labels and aggregate metrics in shared output. Keep private evaluation inputs outside Git and avoid including identifying material in captured shell output.

## Implementation sequence

### 1. Establish a reproducible real-audio baseline

Primary files: `scripts/benchmark_voice_calibration.ts`, `tests/unit/speakerVoiceCalibrationBenchmark.test.ts`; add a separate private-audio runner and synthetic runner tests if that keeps contracts clearer.

- [ ] Preserve the existing synthetic suite as a policy-logic test and label its results accordingly.
- [ ] Add a local evaluation manifest with explicit expected identities, enrollment meetings, query meetings, and negative controls. Ground identity in user confirmation and reviewed source audio, never calendar attendance or the model's own prediction.
- [ ] Reproduce the reported miss in a disposable database using retained recordings and the production extraction/matching path. Record runtime/model versions, profile aggregation policy, and extraction policy for reproducibility.
- [ ] Compare original enrollment audio and query audio: verify the reference is the confirmed speaker, its source channel/timing is correct, and extracted audio is not silence, overlap, or another speaker. Compare repeated extraction of identical audio to distinguish nondeterminism from channel or profile effects.
- [ ] Include multiple people and sessions, short/long references, changed microphones or call channels, unknown people, competing profiles, overlap, and degraded audio. Report actual coverage and unavailable cases rather than inventing samples.
- [ ] Split development and held-out evaluation by meeting; where data permits, reserve identities too. Never enroll the query meeting before scoring it. Adding a confirmed query to a profile must be evaluated against a later independent meeting.
- [ ] Report recall, wrong-person suggestions, abstentions by reason, latency, extraction cost, and profile evidence coverage. Separate unknown-person false accepts from wrong-person matches among enrolled people; report denominators and uncertainty.

Exit: reproduce the miss, identify which causes remain supported, and save a privacy-safe baseline report. If source identity cannot be verified or there are insufficient independent sessions, mark acoustic acceptance pending. Do not tune thresholds against an unverified case.

### 2. Separate enrollment audio selection from playback snippets

Primary files: `electron/speakerEnrollmentCandidate.ts`, `electron/speakerEnrollmentAudio.ts`, `src/services/speakerCandidateEvidence.ts`, `src/utils/speakerReview.ts`; focused enrollment/audio/selector tests. Inspect native extraction before changing its contract.

- [ ] Introduce a dedicated bounded enrollment interval selector. Reuse timing and overlap predicates, while leaving short playback sampling behavior intact.
- [ ] Select deterministic, non-overlapping remote speech distributed through the meeting. Count unique supported speech, not silence padding, overlapping windows, or duplicate snippets. Require source support within each selected interval; a meeting-wide cluster centroid must not prove every selected interval's identity.
- [ ] Start evaluation with a maximum 60 seconds of selected speech, at most 12 intervals, and a target of 30 seconds where available. These are extraction budgets to benchmark, not proven reliability thresholds. Evaluate sparse cases without pretending more speech exists.
- [ ] Preserve source-to-extracted-clip interval mapping. Keep reference playback tied to original timestamps; never expose concatenated-clip offsets as original meeting offsets.
- [ ] Reject mixed-speaker evidence and invalid/nonfinite or dimensionally incorrect vectors. Keep native intermediate embeddings bounded and private; no raw chunk arrays in renderer IPC or transcript JSON.
- [ ] Record extraction policy version and source fingerprint. Revalidate transcript trust, capture generation, identity binding, deletion/disable state, and source availability immediately before committing extracted evidence.
- [ ] Exercise both cached finalization candidates and on-demand enrollment. Neither path may bypass the same quality/version checks.

Exit: on qualifying recordings, enrollment uses more independent clean speech than the playback pair; silence, overlap, and duplicated excerpts cannot inflate its quality. Baseline comparison determines whether richer selection actually improves matching.

### 3. Make profile evidence versioned and aggregation reproducible

Primary files: `electron/speakerVoiceStore.ts`, `src/services/speakerCandidateEvidence.ts`, schema definitions and the next ordered Drizzle migration located at implementation time; store/migration/merge tests.

- [ ] Retain original person ownership, meeting source, capture revision, candidate digest, and extraction provenance. Add only metadata needed to identify the extraction policy, interval fingerprint, active evidence selection, and upgrade state.
- [ ] Separate extraction-policy version from embedding-space compatibility. Partition evidence by full model/runtime/embedding compatibility before aggregation; never label a mixed vector with one row's provenance.
- [ ] A richer extraction from the same source supersedes that source's selected evidence atomically. Do not count old and new overlapping extractions as independent support. Preserve old rows for rollback until explicitly purged; deletion must remove both current and superseded biometric evidence.
- [ ] Derive a profile revision/fingerprint from selected source evidence and settings, allowing match caches to invalidate reliably. Keep merge/restore projections based on original ownership.
- [ ] Compare the existing duration-weighted centroid with capped per-meeting weighting on the development set. Evaluate bounded per-session representatives only if centroid behavior is demonstrated to lose channel variation. Avoid unbounded maximum-over-samples matching, which increases false accepts as profiles grow.
- [ ] Choose the simplest aggregation rule that improves held-out recall while meeting precision gates. Preserve the previous rule if alternatives do not pass. Version any adopted rule and its matching policy.

Exit: deterministic profiles with no incompatible blending or duplicated source weighting; migrations preserve old evidence, settings, deletions, and reversible merges.

### 4. Improve existing profiles through bounded reconciliation

Primary files: `electron/speakerVoiceHandlers.ts`, `electron/speakerEnrollmentCandidate.ts`, `electron/speakerVoiceStore.ts`; handler and lifecycle tests.

- [ ] Replace the whole-person `already_enrolled` shortcut with source-level accounting: confirmed eligible source, current extraction version, selected evidence, prior attempt, and profile need.
- [ ] Reconcile newly confirmed sources for existing profiles and upgrade legacy sparse extractions where retained audio supports improvement. Only explicit individual-speaker confirmations are eligible; tentative matches cannot enroll themselves or bootstrap future identity claims.
- [ ] Use one serialized extraction queue with deduplication by source/version. Bound automatic upgrade attempts initially to three sources per person per pass. Yield to recording and foreground inference; support cancellation and bounded retry/backoff.
- [ ] Keep profile/suggestion reads responsive: return existing usable evidence and upgrade status while reconciliation runs. Do not scan and re-extract every confirmed meeting on every page visit.
- [ ] Persist content-free attempt outcomes keyed by source fingerprint and extraction policy. Retry only when source/policy changes or the user requests it; missing audio must not create an endless retry loop.
- [ ] After asynchronous extraction, atomically recheck identity revision, binding, source validity, profile settings, and deletion intent. Deletion/disable during work wins. Merge/restore and reattribution during work require recomputation or cancellation.
- [ ] Failed or cancelled upgrades retain the prior usable profile. Successful upgrades publish the new profile revision and invalidate affected match results.

Exit: sparse profiles can improve from authorized evidence across sessions, repeat visits do not duplicate work, and deletion cannot be reversed by queued work.

### 5. Make recognition decisions inspectable and refreshable

Primary files: `src/services/speakerVoiceMatcher.ts`, `electron/speakerVoiceHandlers.ts`, `src/api/speakerVoice.ts`; matcher and IPC tests.

- [ ] Return a typed internal decision covering matched, insufficient evidence, incompatible evidence, below threshold, ambiguous, rejected, disabled, and unavailable/failed extraction. Preserve the existing nullable-match wrapper if required by callers.
- [ ] Validate query evidence against current capture generation and transcript trust before scoring, including cached candidates. Validate source/digest freshness again when accepting a suggestion.
- [ ] Cache only under query source/digest, profile revision, matching-policy version, and rejection revision. Invalidate on confirmation, rejection, profile update/delete/disable, merge/restore, transcript replacement, and completed reconciliation.
- [ ] Expose only the safe presentation status and permitted suggestion metadata to the renderer. Do not display cosine similarity as a percentage confidence or reveal the nearest person's name when no qualified suggestion exists.
- [ ] Evaluate thresholds only after source/selection/aggregation comparisons. Keep the existing thresholds during baseline work; any change needs a versioned policy and held-out precision/recall evidence. Calendar hints must never alter acoustic eligibility.

Exit: every abstention has a testable reason; stale cached evidence cannot produce a visible or confirmable match.

### 6. Present useful, honest feedback in both entry points

Primary files: `src/components/features/MeetingView.tsx`, `src/components/features/SpeakerIdentificationModal.tsx`, `src/components/KnowledgeGraph/PeopleTab.tsx`, `src/api/speakerVoice.ts`; corresponding DOM tests.

- [ ] Show qualified tentative names on meeting entry and open the exact speaker for review. Confirmed identities take precedence over pending suggestions.
- [ ] Distinguish loading, no reliable match, and lookup failure. Preserve retry for failures without turning every abstention into a warning or naming an unqualified candidate.
- [ ] Show profile evidence maturity with factual wording such as “Limited voice samples” and “Voice samples from N meetings.” Explain when additional confirmed speech could help, without promising that a duration guarantees accuracy.
- [ ] Show upgrade progress/failure, missing source audio, and explicit deletion/disable states in People. Offer an appropriate retry or existing explicit re-enable action.
- [ ] Confirmation retains the saved identity even if voice enrollment fails, and offers a voice-specific retry. An intentional enrollment opt-out is not a generic error.
- [ ] Synchronize header, modal, and People state after mutations. Fence late responses when switching meetings or changing source revisions, and prevent rejected suggestions from reappearing after modal close.

Exit: visible recognition state stays consistent across navigation, confirmation, rejection, upgrade, and restart. Verify keyboard operation, narrow layouts, and several matched/unmatched speakers in a disposable app profile.

## Acceptance and release gates

1. **Acoustic performance:** rerun the original independently labeled case and held-out multi-person cases through actual native extraction. Compare against baseline. The reported same-person miss must produce the correct suggestion using independent enrollment evidence; otherwise report the unresolved cause and do not declare it fixed.
2. **Precision:** zero wrong-person suggestions observed in the held-out acceptance set and improved recall over baseline, with no regressions in previously passing cases. Publish sample counts, denominators, and uncertainty; zero observed errors is not a claim of zero population risk. Freeze the acceptance set and policy before the final run.
3. **Evidence limitations:** if more independent labeled audio is needed, finish code and synthetic lifecycle verification, identify the missing evaluation coverage, and keep the new acoustic policy disabled. A synthetic pass cannot authorize global threshold changes.
4. **Lifecycle:** focused tests cover same-source replacement, restart/idempotency, missing recordings, failed upgrades, concurrent delete/disable, reattribution, merge/restore, mixed provenance, stale candidates, invalid vectors, and query/enrollment separation.
5. **UI:** actual Electron verification covers proactive matches, correct speaker selection, rejection refresh, failed lookup retry, sparse-profile explanation, successful upgrade, and deletion. Keep production recordings and identities intact during evaluation.
6. **Cost:** report queue wait, extraction duration, and peak memory for short/long sources. Confirm the selected budgets are enforced and profile reads do not wait for global extraction; verify that foreground capture preempts upgrades.

Run focused Vitest suites for changed behavior, `pnpm exec tsc --noEmit`, `pnpm run lint`, and `git diff --check`. Run the full suite after the integrated changes; run native tests and runtime packaging checks if native extraction changes. For SQLite ABI failures, rebuild for Node tests and restore with `pnpm run ensure:sqlite-abi` before Electron verification.

## Rollout, rollback, and documentation

- Deliver in reviewable slices: baseline/diagnostics; enrollment selection and evidence versioning; bounded profile upgrades; evaluated matching policy and UI integration. Keep each slice compatible with old profiles.
- Make migration additive. Introduce a persisted, default-off rollout switch for the new extraction/aggregation policy until acceptance passes. Existing recognition continues under its previous policy.
- Enable upgrades first in a disposable profile, then perform a bounded local rollout under the existing user authorization and deletion settings. Read-only benchmark mode must not alter production bindings, profiles, or rejection history.
- Roll back by disabling the new policy and queue and selecting retained prior evidence; never resurrect deleted data. Document compatibility limits before any irreversible cleanup of superseded evidence.
- When implementation adopts the policy, add a new `docs/decisions.md` entry explicitly superseding the enrollment and calibration portions of “2026-09-05 - Cross-meeting speaker recognition using opt-in local voice profiles.” Reconcile its stale checkbox/default-off wording with current confirmed-enrollment behavior. Do not mark a proposed decision as already accepted while writing this plan.
- Keep PR descriptions and changelog entries free of private meeting information. Report code checks, native/runtime verification, measured recognition results, and remaining evaluation gaps separately.

## Completion criteria

The global implementation is complete when existing sparse profiles can safely improve, eligible future meetings expose correct qualified suggestions, abstentions have honest explanations, and the independent acoustic acceptance set demonstrates improved recall without observed precision regressions. No person-specific exceptions, guessed identities, or query-to-enrollment leakage are permitted.
