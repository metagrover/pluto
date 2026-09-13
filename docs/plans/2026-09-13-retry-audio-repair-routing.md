# Retry audio repair: connect the existing path safely

Status: Draft after source review and read-only diagnosis. No application code or saved meeting data changed for this plan.

## Goal

Make manual transcript retry use the existing audio-repair path when appropriate, then reassess speaker samples from the regenerated transcript. Preserve capture and notes-quality safeguards. Do not add a new pipeline, background scan, or cache.

## What already exists

| Responsibility | Existing implementation | Finding |
| --- | --- | --- |
| Select retry work | `src/App.tsx`, `src/services/postMeetingProcessingCoordinator.ts` | Rebuilds for speaker-label retry and recovered recordings, but ordinary manual retry does not rebuild for `system_capture_incomplete` alone. |
| Rebuild saved audio | `rebuildSealedAudioForRetry` in `src/services/finalTranscription/runPersistedMeetingFinalTranscription.ts` | Checks sealed generation and interval dispositions, stitches participant audio, remixes, saves replacement paths, and removes newly created files on rebuild failure. |
| Read verified chunks | `electron/captureJournalRecovery.ts` | Existing source reconstruction rejects missing/corrupt artifacts and checks chunk integrity. |
| Preserve timing | `electron/timedWavStitch.ts` | Decodes chunks separately and positions them on the timeline, including padding. Output duration is not proof of captured coverage. |
| Gate transcript trust | `src/services/finalTranscription/systemCaptureEvidence.ts` | Ordinary validation requires the startup availability flag as well as captured/verified-silence intervals. The rebuild path bypasses that ordinary check after reconstruction. |
| Select speaker samples | `src/utils/speakerReview.ts`, `electron/speakerSample.ts` | Uses participant audio and timed transcript segments; rejects an entire segment when it overlaps a blocking speaker. The clean-interval helper is also used for voice enrollment. |

The previous recommendation to add recording verification and rebuilding duplicated existing functionality. The initial defect is inconsistent retry routing, with a trust boundary that must be checked before enabling the existing route more widely.

## Evidence and limits

The reported September 3 meeting has no notes run: its transcript is `needs_attention` with `system_capture_incomplete`. Its sealed journal records participant audio as `unavailable_at_start`, while all 445 intervals are marked captured. All 445 raw participant chunks exist and match recorded checksums. The saved microphone, participant, and mixed WAV files also exist.

The recorded interval timeline is contiguous and ends at 2,252.981 seconds. Raw participant PCM totals about 2,247.613 seconds. The first interval accounts for 4.173 seconds of the difference; all other individual shortfalls are below 0.031 seconds. This locates the discrepancy; it does not prove those periods were silent, nor establish whether startup delay explains it. Stitching can pad these periods, so a full-length reconstructed WAV cannot resolve this uncertainty by itself.

The saved transcript contains 68 long alternating channel segments. The current sample selector returns zero clips for `Them` because of overlaps. This is a selection result, not evidence that participant audio is missing. Reliable new transcript timing may resolve it without changing the selector.

Source review used filesystem fallback because graph tools were unavailable. Five existing focused suites passed: 90 tests across App retry routing, persisted final transcription, processing coordination, speaker review, and sample loading. Existing worker tests cover the contradictory startup flag when rebuilding is explicitly enabled; App tests do not cover this reported failure state selecting that rebuild. Passing these tests is not real-meeting acceptance.

## Proposed work, in order

### 1. Verify the existing repair boundary on a private copy

Use the current reconstruction code and timing evidence to account for the first interval and remaining PCM shortfalls. Inspect existing capture receipts/timestamps and relevant audio boundaries without changing the original journal. Distinguish intact artifacts from complete capture.

Confirm that successful reconstruction is sufficient evidence for this case before allowing it to bypass `hasCompleteSystemCapture`. If it is not, preserve `needs_attention` and report the unresolved interval. Do not flip the startup flag, manufacture verified silence, or treat the `rebuildSealedAudio` request alone as evidence. Any necessary check belongs at the existing reconstruction boundary, not in a separate verifier service.

### 2. Connect manual Retry to that existing boundary

Add an explicit manual-retry decision for `system_capture_incomplete` with the required sealed-journal inputs. Reuse the existing rebuild, fresh transcription, speaker attribution, and guarded publication flow. Leave ordinary successful retries and automatic admission unchanged.

Do not broaden `needsRecoveredAudioRebuild` indiscriminately: it also controls automatic scheduling. An explicit failed retry must not introduce a boot-time or repeated background rebuild loop. Surface an actionable rebuild failure through the existing meeting notice rather than only logging an exception.

### 3. Reassess samples after transcript repair

First run the existing sample picker on the regenerated transcript. If valid clips return, no sample-selection algorithm change is needed. If genuine partial-overlap cases remain, add a focused playback-only rule to retain clean portions, using trustworthy timing and matching excerpts. Keep voice enrollment's evidence rules unchanged; do not casually modify the shared clean-interval helper or remove overlap checks. Show a reason when no reliable sample exists.

## Verification and completion

- Add a regression that exercises the actual manual Retry boundary for this integrity state, including the selected rebuild option. Preserve ordinary and automatic routing tests.
- Cover missing/corrupt chunks, genuine capture gaps, generation changes, failed rebuild/save, and cancellation using existing suites. Confirm no false validation, accidental deletion of originals, or stale publication.
- Test the existing selector against repaired timings; add partial-overlap playback tests only if the extra selection change is needed.
- Run a private end-to-end repair for the reported case. Verify the resulting transcript against source audio and play a participant sample. Only then attempt the app retry and check persistence and downstream notes behavior.
- Measure reconstruction and total retry time separately. Keep reconstruction off normal successful paths; use existing saved repaired paths on later retries where their current evidence permits it. Do not add a new cache or repeated full verification to every playback request.

Complete when manual retry either safely regenerates the transcript and exposes a usable sample, or accurately reports the specific unresolved recording gap. Notes must continue to require a validated transcript. The unrelated notes-capacity and identity-supersession work remains separate from this focused repair.
