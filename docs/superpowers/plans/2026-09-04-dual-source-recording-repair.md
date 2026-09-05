# Dual-source recording repair implementation plan

> **For agentic workers:** Use test-driven development for each logic repair and independent spec and code review before completion.

**Goal:** Capture microphone and System audio reliably, suppress loudspeaker echo in the live reading view, and persist source-grounded final Parakeet text with System-only participant diarization.

**Architecture:** Preserve raw capture evidence. Reconstruct each chunk at its actual sample rate and journal time before transcription. Treat unavailable System capture as missing attribution evidence, not proof that all microphone speech belongs to the user. Live echo suppression remains reversible presentation metadata; final canonical segments remain authoritative.

**Tech stack:** Electron, React, TypeScript, native Swift/CoreAudio, FluidAudio/Parakeet, FFmpeg, Vitest.

**Tracking:** #725 final attribution; #670 live echo; #746 capture reconnect. The user approved the repair scope and restated the four acceptance criteria on September 4. Keep all meeting-specific evidence and paths out of GitHub and tracked fixtures. Changes remain local; preserve the seven pre-existing modified files.

## 1. Reconstruct changing audio formats correctly

- [x] Add a real-FFmpeg regression with contiguous 32 kHz, 48 kHz, and 44.1 kHz chunks, distinct pulses, and journal timestamps; assert pulse placement, duration, and late content retention. Demonstrate failure using production-equivalent concatenation.
- [x] Extract the production WAV stitching operation into `electron/timedWavStitch.ts`; normalize individual chunks before concatenation and honor gaps, initial delay, overlap policy, and bounded resource usage. Wire `electron/main.ts` to that exact tested operation.
- [x] Run `pnpm exec vitest run tests/unit/timedWavStitchPlan.test.ts tests/unit/timedWavStitch.test.ts` and replay original affected chunks into a separate diagnostic artifact.

## 2. Repair capture from identified evidence

- [x] Trace native process selection, default-output changes, format reconfiguration, and renderer readiness. Distinguish valid silent callbacks from missing capture.
- [x] For each confirmed defect, add a failing lifecycle or native regression before the narrow fix. Keep tap generations isolated and preserve final recorder stop events.
- [x] Compile tests from current Swift sources and verify startup/reconnect behavior. Do not claim hardware acceptance from synthetic tests.

## 3. Preserve honest attribution with missing source evidence

- [x] Add a failing regression for capture known unavailable and microphone speech present: no verified all-Me canonical commit or downstream analysis. Preserve existing canonical text when a retry cannot establish identity.
- [x] Carry source availability evidence through the production finalization boundary and refuse trusted attribution when complete System capture cannot be established; legitimate silent, healthy System capture must continue to support a local-only meeting.
- [x] Verify source digest, capture generation, lease ownership, cancellation, and atomic commit safeguards, including the existing explicit completed-result retry.

## 4. Verify live and final presentation

- [x] Trace staggered microphone/System revisions through the actual reconciler, workspace model, turn builder, and rendered React DOM. Add failing regressions for confirmed gaps before editing.
- [x] Retain raw rows; suppress strongly aligned echo copies while retaining local additions, corrections, numbers, negations, and overlap. Continue diarizing System audio only.
- [x] Verify finalized recovered transcripts ignore obsolete live labels, including empty final results.

## 5. Integration and acceptance

- [x] Run affected unit/DOM/native tests, TypeScript, lint/format, changelog validation, and diff checks; review spec compliance and code quality independently.
- [x] Reconstruct the affected meeting to new artifacts, retaining old paths and database backup. Retry through production APIs only after source validity is established; inspect saved output and actual rendered output if available. Missing historical participant audio cannot be recreated.
- [x] Exercise a fresh dual-source capture with known playback/local speech and device routing when the runtime is available. Report recorded evidence, test evidence, and remaining real-call acceptance separately.
- [x] Add a content-free changelog fragment and durable decision describing the proven fixes and acceptance limitations.

## Runtime findings during acceptance

- Native quiet-start and new-process playback testing confirmed global capture remains active through silent periods after disabling tap autostart. Parakeet recognized both reference repetitions.
- The historical retry was exercised against a backup and then through the same production worker/database APIs. It preserved canonical and raw live text and saved `needs_attention` with `system_capture_incomplete`; the actual packaged UI was inspected.
- A fresh AirPods capture exposed a further native format defect: initial System chunks held half the expected sample count. Restoring playback speed in a separate diagnostic artifact restored the exact reference phrase. The native fix now uses a tap-only aggregate and its actual post-start input format, validates buffer layouts, and guards format changes. Built-in quiet/playback and targeted probes passed. A subsequent actual AirPods capture retained the full System sample count and Parakeet recognized all reference playback words.
- Packaged stop exposed an existing FFmpeg executable path inside the ASAR archive. The path resolver, explicit unpack configuration, and runtime verifier now cover both FFmpeg and ffprobe; actual packaged recovery and fresh stop succeeded after this repair.

- The fresh built-in-speaker recording saved the reference playback as `Them` and the actual local follow-up as `Me`; both stored segments and the app transcript were inspected. Its live mixed echo/local row exposed a prefix-trimming gap, now covered by EOU-to-DOM regressions while retaining raw text.
- Saved-status broadcasts incorrectly treated Electron's event argument as a meeting ID. The listener signature is corrected, with DOM regressions for published-note refresh and broadcasts without a meeting ID.

- An additional fresh capture exposed accumulated timing drift across reconnect chunks. Reconstruction now anchors every contiguous chunk to its journal interval using its decoded duration. A real-audio final-worker replay preserves all 26 reference playback words and three local turns. Cross-channel text cleanup cannot delete a retained System word by revisiting mic words already removed acoustically.
- Live word timing now permits removing an exact echo span between local speech in the same row. EOU-to-DOM regressions preserve both local sides and genuine earlier repetitions; unverifiable word timing fails closed.
- Final broad verification passed 362 test files / 4,059 tests, TypeScript, lint, changed-file Biome checks, changelog validation, and diff checks. The rebuilt package passed all seven runtime checks.
- After a fresh database backup, the diagnostic meeting was pointed at separately rebuilt, checksum-verified audio artifacts through the production database API. Only its three audio paths changed. A new native Parakeet run through the persisted finalization worker saved the complete reference playback as remote speech and three local turns as `Me`; actual saved presentation reconciliation matches. Notes generation was deferred during this maintenance replay.
- The Mac was locked during the final build verification, preventing the latest packaged visual/live check. Earlier packaged built-in-speaker recording and saved UI were verified. The two synthetic playback voices produced one remote cluster, so individual remote-participant separation still requires a real multi-person call.

## Remaining runtime acceptance

- [x] Inspect the rebuilt app and corrected diagnostic transcript after the Mac is unlocked. The actual saved view shows two remote speakers and the local turns as Me.
- [x] Verify the final word-timed live echo span repair during a fresh loudspeaker recording and saved separation of both diagnostic voices. Broader natural multi-person calls remain an accuracy limit to assess separately.

## Approved follow-up: remote speaker separation

The user approved this follow-up after a reproduced two-stage failure: default clustering merged two playback voices; stricter experimental clustering separated them but ASR word spans containing digital silence caused a false low-coverage rejection.

- [x] TDD: Extend `applyRemoteSpeakerClusters` with independently measured System energy coverage; exclude confirmed digital silence from word support and coverage, preserve unknown/overlapping speech, bound frame-boundary tolerance, and pass native evidence from `runFinalTranscription`. Retain existing thresholds and raw word timing. Verify real diagnostic replay and synthetic missing/noisy/overlap controls.
- [x] Calibrate native offline clustering against one/multiple real-speaker, short-turn and overlap controls. Investigate distance-versus-similarity contract before adopting a global setting. Add a native regression and preserve automatic speaker count.
- [x] Present transcription completion separately from remote-speaker labeling, with unit/DOM coverage for fallback and successful states.
- [x] Replace the Intel ffprobe dependency artifact with a portable native executable; verify architecture before any packaged tool launch to avoid Rosetta notifications.
- [x] Independent spec/code reviews, focused/broad tests, native build, package verification, backed-up production retry, and actual rendered/live verification. Remaining limitations are recorded below.

### Follow-up verification evidence

- Independent alignment review caught and repaired duplicate coverage from overlapping expanded turns of the same cluster. The final alignment unions coverage, preserves raw word objects, and leaves contradictory or incomplete evidence unassigned. A three-hour synthetic workload completed in 1.76 seconds.
- Native clustering tests exercise actual AHC distance boundaries. The production initializer separates the two diagnostic voices without a forced count. Bounded real-speech controls and residual underclustering are recorded separately in the calibration note.
- Successful retry now preserves valid original liveSegments (including an explicit empty array), with regressions for missing and malformed legacy evidence.
- Final broad JavaScript run: 364 files / 4,109 tests passed. TypeScript, lint and changelog checks passed. All 161 native tests pass after replacing a test-only scheduler-yield race with an explicit readiness signal and bounded timeout; production behavior and assertions are unchanged. Native production compilation passed.
- Actual package verification caught electron-builder omitting the nested optional ffprobe binary. A pinned root optional dependency and collector regression repair the omission. The rebuilt signed package passed all seven runtime checks; actual packaged Electron resolution reaches the native unpacked executable.

- A backed-up production retry retained every reference playback word, separated both remote voices, and preserved the original five live evidence rows. The actual packaged transcript UI displayed both remote labels and the local turns as Me.
- A fresh built-in-speaker recording captured both sources and automatically finalized with two remote labels plus local speech. Its live display exposed a one-letter ASR substitution inside a long echo span. The repair permits one interior alphabetic substitution only with at least 95% exact ordered tokens, exact boundary words and verified aligned word timing; protected numeric, negation and correction terms remain conservative. EOU-to-DOM tests reproduce the case, preserve the local tail and raw evidence, and restore revised tentative words. Independent review and 75 focused tests passed; a 2,000-row replay took 48 ms. The rebuilt live UI suppressed the long mismatched echo and retained local speech, exposing one residual final echo word. Actual native EOU replay established that its end timestamp grew through the following silence. A matcher-only fallback requires closely aligned final-word onsets, a short System word, a bounded mic tail touching the next local word, and an independently aligned preceding span. All 78 focused tests and independent review pass. Replaying the actual native events through the production projection now removes the full echo, retains the local follow-up, and leaves raw text and every word timestamp unchanged.

## General live recognition mismatch repair

A subsequent fresh loudspeaker capture merged two remote words into one microphone token. Fixed-length lexical matching could not handle this safely. The follow-up uses bounded monotonic alignment with exact surrounding anchors and independent PCM envelope evidence for small disputed word groups. Critical corrections and inserted local words remain visible. The acoustic helper requires strong correlation, low residual, stable delay across adjacent windows, sufficient combined speech activity and minimal mic-exclusive energy; a quiet overlap can remain ambiguous, so this is presentation corroboration rather than general AEC or voice identity.

- [x] TDD acoustic helper with sparse speech boundaries, independent speech, double talk, mic-only speech during a System pause, gaps, invalid input, unstable delay, bounded history and retained positive metadata. Actual captured audio covers the disputed words and excludes the local follow-up.
- [x] TDD source-clock and session integration. Feed the exact EOU PCM frames using each source offset; isolate evidence per session and refresh reading rows when delayed evidence arrives without another ASR revision.
- [x] Complete bounded sequence matching and EOU-to-DOM replay against actual PCM/native evidence; preserve all raw words and timing. Substitution, merged-word, omission and long-pause regressions pass, followed by fresh live acceptance.
- [x] Independent review, final broad checks, rebuilt package and actual live/saved verification.

- Independent review verified one shared path for all non-exact whole/partial matches, with no text-only fuzzy bypass. Word-boundary tolerance uses the same paired acoustic windows, requires positive mapped overlap and at most 250 ms residual at each boundary, and retains 80 percent independent coverage on both sources. Expired/mismatched pairs cannot contribute coverage. Stable metadata coalesces only equal-lag windows.
- Actual native-event replay and the observed recognition variants with source-derived timing/acoustics retain only the local follow-up. A replay with different missing leading words remains conservatively visible; no universal ASR-variant or quiet-overlap guarantee is claimed.
- Presentation-only retained-word timing repairs live chronology: the actual replay now shows Call before the later local turn, including its tentative continuation. Raw timestamps remain unchanged; removal of matching evidence restores the raw display order. Ordinary no-echo live ordering is preserved. Independent review and 104 focused tests passed.

### Unequal recognition coverage follow-up

The next actual live recording still displayed playback under both sources. Native replay confirmed that microphone ASR omitted most of one System sentence and padded remaining word ends through silence. The display had not deleted those missing words. The repair therefore needs directional exact alignment that permits System-only omissions, retains every unmatched mic word, and checks each retained match against its own source onset. A long exact anchor with measured stable acoustic lag can support a bounded exact continuation; this is text-and-timing evidence, not invented acoustic proof for uncovered tail words. Long padded System intervals cannot justify removal, and critical skipped corrections must cause abstention. Nonexact substitutions retain the separate paired-PCM requirement.

Original native word timings are now preserved alongside raw live wording for future diagnosis, without converting them into canonical word evidence or overwriting display-independent timestamps. The latest failed live run remains retained; broad tests and prior successful saved diarization do not establish live acceptance.

- The rebuilt omission repair passed independent review, 365 JavaScript files / 4,154 tests, TypeScript/lint and seven packaged runtime checks. A subsequent actual capture still duplicated a one-word recognition substitution. Original live rows and native timings were successfully saved and replayed exactly; final saved/visible speaker labels were correct. The remaining rejection is the acoustic detector: changing mic gain makes the loudness-envelope correlation/residual fail over the disputed word despite stable source delay. This fresh live acceptance is explicitly failed; no lexical exception or lowered acoustic threshold has been applied.

### Acoustic window phase repair

The exact saved-row/PCM replay exposed fixed window phase as a further false-negative source. Two overlapping half-second windows pass every existing correlation, residual and mic-exclusive-energy threshold and supply more than 600 ms of distinct active speech; fixed non-overlapping half-second sampling never considers that pair. The bounded repair evaluates the same scorer every 100 ms and corroborates nearby positive windows using unique active-bin support on both channels. It retains only intervals that actually passed, keeps source gaps and stable-lag requirements, and does not lower thresholds or introduce a spectral model. Independent speech and added-local-speech controls must still abstain under the complete sliding search, including shifted source origins.

- Sliding implementation independently reviewed: at most six candidate windows; unique active support counted in both source clocks; retained intervals coalesce only with overlapping equal-lag evidence. All ten tested first-window origins cover the actual disputed word. Recorded local-only and local-mixture controls at -12, -6, 0 and +6 dB reject corroboration. A synthetic same-carrier overlap can admit proof; four synthetic-PCM/native-shaped-EOU-to-DOM regressions explicitly admit that proof and still preserve local additions, negation, spelled numbers, modal corrections, local tails and raw evidence. This remains bounded text-guided corroboration, not a double-talk classifier.
- Final local broad checks after sliding repair: 365 JavaScript files / 4,159 tests pass, TypeScript and lint pass, changelog validates 181 fragments. Native code is unchanged from the 161-test passing run. An independent 160-second mixed-rate stream measured 0.80 ms median / 1.02 ms p95 append time. Fresh packaged live acceptance remains pending.

- The rebuilt sliding detector passed seven packaged runtime checks. A fresh actual loudspeaker run displayed the complete reference playback once under Call, with no You duplicate while idle. A local follow-up after a long pause exposed one remaining echo tail: native EOU retained the original final-word onset but extended its end to the next local word tens of seconds later. The final saved transcript retained both remote voices and the correctly decoded local question; original live wording/timing remain saved. The bounded repair replaces the arbitrary two-second padding cap with actual paired-PCM coverage of the aligned onset and short System-word duration, preserving the preceding long-span, identical-word, onset and next-token guards. This does not widen timing tolerances or infer speech from the padded interval.


### Source ownership and merged-word follow-up

The next fresh capture failed both paths. Live recognition merged a reduced two-word pronunciation into a shorter mic token; actual paired acoustic support passed, but the spelling-only candidate gate rejected it. A narrow 1-to-2 or 2-to-1 pronunciation-shape alternative now retains exact surrounding anchors, two consonants and vowel positions, critical-word guards and paired PCM evidence. Recorded replay and mixed-audio unrelated-word controls pass independent review; pronunciation remains approximate and is not identity evidence.

The final decoder captured the complete remote sentence, but its terminal word extended through silence into a later local reply. Generic mixed-track activity arbitration reassigned that System row to Me. Recovered channel reconciliation now preserves the chosen source row's speaker while retaining existing duplicate removal, ambiguity accounting and coverage checks. A terminal exact echo word can extend an already aligned sequence only with closely aligned onset, measured remote onset activity and no near-end activity over the mic word. Missing evidence and local or later repeats remain intact. Explicit full retranscription rebuilds canonical machine text; speaker-label repair preserves historical wording and original live evidence stays unchanged.

The exact recording has been rerun through native decoding and the complete persistence path in a database copy. The repaired candidate retains the complete second remote sentence and the genuine local question without the echoed terminal word. A short leading remote word remains general because its ASR timestamp lies wholly in measured System silence before the diarization turn; no unsupported speaker assignment is made. Package and fresh UI acceptance remain pending until the final reviewed build is exercised.


### Final local verification

The final reviewed build passes 365 JavaScript test files / 4,183 tests, TypeScript, lint, changelog validation, the 12 directly changed native runtime tests, native AudioCap compilation, and all seven packaged runtime checks. Lint retains two pre-existing broken store-symlink warnings. A full native package run passed the changed suites before the XCTest harness later stalled without CPU activity; the independently verified 161-test run remains the broad native baseline. The first earlier post-signing FFmpeg version probe timed out; architecture inspection confirmed arm64 and subsequent complete runtime checks passed without code changes or Rosetta.

A verified database backup preceded a new native transcription of the latest failed recording. The persisted canonical and actual packaged UI retain both remote sentences under their numbered voices and the genuine local question as Me, remove the terminal echo, and preserve all original live rows and capture generation. A fresh built-in-speaker recording in this build then displayed both playback voices once under Call and the user's spoken follow-up separately under You. The user confirmed the live result. After stopping, the saved database and actual UI show both numbered remote speakers and local turns as Me, with no echoed duplicate. A short leading word still has a general remote label because its ASR timestamp precedes independently supported speech; no confidence threshold was loosened to name it. Precise quiet simultaneous speech and broader natural multi-person accuracy remain limitations, not claims covered by this diagnostic acceptance. Pre-landing review also made partial native startup rollback exception-safe and separated a renderer scheduling delay from durable native capture failure. Delivery was requested after this acceptance.
