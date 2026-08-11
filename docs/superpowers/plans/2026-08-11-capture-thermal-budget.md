# Capture Thermal Budget Implementation Plan

**Goal:** Keep a sustained macOS recording responsive and thermally bounded without weakening durable capture, live transcript completeness, or the speech-like live view.

**Architecture:** Treat recording as an explicit foreground resource lease. Remove renderer work that is mounted but invisible, replace frame-rate-driven acoustic classification with a fixed low-frequency sampler, keep live word reveal work proportional to the active turn, and pause queued local-LLM synthesis for the entire capture lease. Preserve MLX transcription and capture-journal evidence as the source of truth.

**Privacy:** Tests use generated event streams, synthetic owner IDs, and synthetic transcript text. Diagnostics record only state transitions and aggregate timing/load measurements; they never record transcript text, identities, audio, meeting IDs, paths, or source-derived incident metrics.

## Task 1: Eliminate invisible capture rendering

- Add a failing production-boundary test proving `AudioManager` has no waveform canvas, elapsed presentation timer, or animation-frame loop.
- Remove the hidden legacy waveform tree, its analyser state, and the unused analyser callback wired by `App`.
- Keep `AudioManager` headless and leave the visible recording status owned by `RecordingCaptureBar`.

## Task 2: Bound acoustic speaker sampling

- Add a scheduler seam with fake-clock tests that proves at most five samples per second and deterministic cancellation.
- Replace the animation-frame speaker monitor with that scheduler at a 200 ms cadence.
- Preserve the existing RMS thresholds, minimum switch interval, activity evidence, and final speaker-window close behavior.

## Task 3: Bound live word-reveal work

- Add a long synthetic transcript test proving a word tick updates only the active reveal entry rather than cloning the full transcript history.
- Memoize stable speaker turns so historical transcript DOM does not rerender for every new word.
- Preserve word-by-word reveal, reduced-motion behavior, manual-scroll suspension, Return to live, and live-edge following.

## Task 4: Hold background synthesis behind the capture lease

- Add a pure pause-reason coordinator with tests for overlapping capture, transcription, and downstream-processing reasons.
- Acquire the capture pause when the authoritative journal lease starts; release it only when seal completes, seal fails after stop, or the owning renderer is destroyed.
- Keep queued work pending and resume only when every foreground reason has cleared.

## Task 5: Verify the thermal budget and recording UX

- Run focused tests first, then the complete unit suite, lint, changelog validation, high-severity audit, TypeScript baseline comparison, and production builds.
- Run a sustained isolated synthetic capture workload and report only process-level CPU/memory/load aggregates.
- Exercise live follow, manual review, Return to live, stop/seal, and post-meeting transition without real meeting content.

