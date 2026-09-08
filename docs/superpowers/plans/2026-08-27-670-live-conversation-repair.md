# Complete live conversation repair — #670

> **For agentic workers:** Use test-driven development and subagent-driven-development for the native slice, followed by spec and quality review. The user approved this repair in the task on August 27.

**Goal:** Preserve distinct live speech from both channels, suppress only supported echo, and commit every completed utterance rather than only the first.

**Architecture:** Keep the native cumulative text and committed-prefix contract. Re-arm utterance detection on resumed speech without resetting the decoder. Reconcile only the reading projection; retain raw candidates for final processing. Both tentative sources remain visible and provisional, with existing paragraph bounds.

**Tech stack:** Swift / vendored FluidAudio, TypeScript, React, Vitest.

## Approved requirements

- Both sources remain visible through alternating speech, interruptions, recognition skew, and provisional updates.
- No global newest-tentative filter. Only matched echo may be hidden.
- Microphone loudness alone does not establish local speech. Use ordered matching and aligned timing; preserve unmatched words and uncertain overlap.
- Repeated speech/silence cycles each publish completion, without losing cumulative text or timing.
- Raw recording/transcript evidence is unchanged. No new meeting is needed for initial replay verification.
- Existing capture and transcript warnings stay truthful. No fabricated per-source health claims.

## Task 1 — Native completion lifecycle

Files: `native/parakeet-runtime/vendor/FluidAudio/Sources/FluidAudio/ASR/Parakeet/Streaming/EOU/StreamingEouAsrManager.swift`, its existing Swift test coverage, `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioEouAdapterTests.swift` as appropriate.

- [x] Add a regression for two utterances separated by sustained silence, plus repeated silence producing no duplicate completion.
- [x] Run the regression and observe the missing second completion.
- [x] Re-arm the completion latch only when speech resumes. Keep cumulative decoder/token state intact.
- [x] Run native tests and build the runtime. Review spec compliance, then code quality.

## Task 2 — Complete, conservative reading projection

Files: `src/services/liveTranscription/liveTranscriptReconciliation.ts`, `src/components/features/recordingWorkspaceModel.ts`, their existing unit tests, and EOU projection/types if word timing is needed for bounded spans.

- [x] Add failing tests for distinct simultaneous tentative sources and delayed source updates.
- [x] Add failing echo tests for long ordered duplicates under mic-dominant volume, unmatched interruptions, differently segmented streams, and lexical similarity with different meaning.
- [x] Remove the global tentative-source selection; retain all nonempty nonsuppressed candidates.
- [x] Replace the RMS veto with conservative ordered/aligned evidence. Never discard an entire mixed-content segment on a partial match.
- [x] Run focused tests, DOM coverage, TypeScript, Biome and diff hygiene.

## Task 3 — Verify and deliver

- [x] Replay existing private audio using the real native runtime, reporting only content-free metrics externally. Check repeated completions, intermediate visibility, and raw evidence preservation.
- [ ] Real rendered-app / loudspeaker-call gate: no app was running, and no new meeting or browser build was started. DOM integration checks passed; actual Electron/live-call verification remains required before closing #670.
- [x] Record the durable decision and a changelog fragment. Update #670 with evidence and remaining real-call gates.
- [x] Integrate only owned changes into `/Users/metagrover/Desktop/pluto`, preserving the unrelated `AutoEndToast.tsx` edit. Verify again there and rebuild the active native binary.

## Task 4 — Order confirmed speech by event time and bound live state

Files: `src/services/liveTranscription/liveConversationProjection.ts`, `src/components/features/LiveTranscript.tsx`, `src/components/features/ZenMode.tsx`, and their unit/DOM tests.

- [x] Reproduce the reported callback-order failure: a later-timestamped Call row arrives first and an earlier-timestamped You row arrives later.
- [x] Replace append-only presentation order with deterministic timestamp, source, and row-ID ordering. Preserve keyed row identity and count delayed callbacks without displaying them out of order.
- [x] Keep detailed correction ranges only in a 45-second, 128-row, 512-part mutable tail; retain older visible text as lightweight committed history.
- [x] Index display ranges once per projection update so reconciliation metadata is not repeatedly rescanned for every row.
- [x] Feed active Ask Pluto from the same ordered, echo-reconciled visible rows shown in the live transcript.
- [ ] Run the full repository gates and perform a rendered real-meeting acceptance pass before closing #670.

## Risks and acceptance boundary

Text matching cannot establish speaker identity. Short repetitions, unique local speech, and uncertain matches stay visible. A repeated native callback or timestamp regression can corrupt the committed prefix, so replay must exercise multiple utterances. A real loudspeaker call remains a separate acceptance gate; do not close #670 based solely on unit tests or renderer fixtures.

## Verification evidence

- Reconciliation/workspace regressions first failed on the original behavior: 7 failures, including missing source, volume-veto echo, lexical substitution, local negation, reordering, split remote utterance, and stale provisional suppression. Numeric follow-ups reproduced 1.5/15, signed values, leading decimals, Unicode minus, and currencies before repair.
- Final isolated checkout: 238 Vitest files / 2,686 tests passed, TypeScript passed, focused Biome passed, diff hygiene passed. The first broad run encountered the existing SQLite ABI mismatch; rebuilding for Node cleared it. Electron ABI is restored for delivery. Existing tests log expected fixture/provider warnings, including an unavailable optional private grounding fixture.
- Native regressions failed on the original one-way latch, then 9 focused vendor tests and 138 native package tests passed. Release executable built. Native spec and quality reviews approved.
- A private diagnostic replay fed the first 180 seconds of the previously recorded mic and system WAVs through the real native runtime, production EOU projection, reconciliation, and workspace model, without starting capture or modifying the recording. It produced 429 updates, 4 mic / 7 system completions before finish (5 / 8 committed rows after finish), 404 updates with both provisional sources visible, zero hidden nonsuppressed rows, and zero runtime/projection failures. Longest provisional spans were 61.68 seconds mic / 45.92 seconds system: the native completion starvation is removed, but a long utterance can still remain provisional across multiple paragraphs. Numeric normalization was subsequently hardened by the separate regression checks. The final active-checkout suite also passed all 2,686 tests, TypeScript, focused Biome, and diff hygiene. The final matcher still suppresses the stored opening pair without mutating raw inputs.
- The stored screenshot opening now suppresses as echo under its original activity windows. Stored raw candidates remain unchanged.
- Complete changelog validation still reports the pre-existing unrelated `2026-08-27-align-knowledge-projects-design-system.md` naming/metadata errors. The consolidated #670 fragment passes its own validator.
- No one-time browser build, new meeting, saved transcript rewrite, provider change, or model download was performed. Native replay and DOM evidence do not certify a new real loudspeaker call.

- Active delivery: owned source/docs/tests applied to the main checkout after verifying no overlapping changes since the worktree base. The separately committed toast change is preserved. `pnpm run build:parakeet` rebuilt and signed the active runtime/probe; `ensure:parakeet` and strict codesign verification passed. Electron SQLite ABI was restored and its readiness check passed. Changes are local and uncommitted; no push or PR was created.
