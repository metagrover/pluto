# Live meeting trust repair design

**Issues:** [#663](https://github.com/metagrover/pluto/issues/663), [#664](https://github.com/metagrover/pluto/issues/664), [#647](https://github.com/metagrover/pluto/issues/647)  
**Related:** [#659](https://github.com/metagrover/pluto/issues/659)  
**Status:** Approved after direct Aug 25 live acceptance feedback and holistic lifecycle review
**Date:** 2026-08-25

## Outcome

Pluto supports back-to-back meetings while earlier meeting artifacts continue in the background. Live transcript text appears promptly, uses punctuation suitable for reading, and never presents uncertain speaker attribution as fact. The recording workspace keeps participant entry visible without exposing capture diagnostics or redundant visual separators. Foreground meeting analysis owns the local model ahead of background knowledge maintenance and reports whether it is waiting or generating.

This design supersedes the clauses in the original #664 recording-loop design that hide participant entry by default, let processing occupy the global recording action, or prohibit presentation-only punctuation for live EOU text. Canonical transcript evidence remains unchanged.

## Scope and delivery

The work is one product outcome with three independently testable implementation slices:

1. #663 owns live latency evidence, speaker-confidence projection, and presentation-only punctuation.
2. #664 owns the recording rail cleanup and back-to-back meeting lifecycle.
3. #647 owns cancellation-aware foreground admission to the local generation slot.

The slices may ship as a small PR stack. Each slice must preserve the contracts of the others and pass its own focused acceptance before the complete Electron flow is tested.

## Live transcript contract

### Latency

Persist and report two content-free measurements:

- recording-start to first visible text;
- first detected speech activity to first visible text.

Assign one opaque correlation ID when capture starts and propagate it through capture activity, the native transcription request, EOU callbacks, projection, and renderer publication. Each process records locally measured monotonic durations between the boundary it receives and the boundary it emits; wall-clock timestamps are diagnostic context only and are never subtracted across processes. Persist boundary timing for first causal PCM frame, first native partial callback, first accepted projection, and first renderer publication together with the correlation ID and clock-domain metadata.

`first detected speech activity` is the first speech-present event emitted after the shared capture-activity detector satisfies its configured threshold and debounce interval. Record the detector version and content-free configuration hash with the measurement. `first visible text` is the first non-empty tentative or committed text painted by the live transcript renderer for the correlated recording. Record whether the qualifying text was tentative or committed. If capture activity evidence or a source channel is unavailable, persist that boundary as unavailable with a reason rather than substituting recording start or another clock.

A private causal replay and a real recording must identify the boundary responsible for any speech-relative delay. The repair must address that boundary directly. It must not use an artificial timer, invented transcript text, or a durable journal receipt as live input.

For ordinary continuous English speech, the acceptance target is first visible text within three seconds of first detected speech. Silence before speech does not count as recognition delay.

### Speaker confidence

Live EOU output remains source-tagged, but source identity alone is not a displayed speaker claim.

- A committed System segment is confidently `Them`.
- A mic segment becomes `Me` only when at least 60 percent of its timed duration is covered by mic-dominant activity, no more than 15 percent is covered by System-dominant activity, and no overlapping System hypothesis contains materially matching words.
- Treat hypotheses as materially matching when their timed intervals are within two seconds and either they share at least four normalized content words with Jaccard similarity of at least 0.72, or a three-word shorter hypothesis is fully contained in the longer hypothesis.
- When materially matching speech appears on mic and System, prefer the System segment and suppress the mic duplicate from presentation.
- A mic segment without enough exclusive or cross-channel evidence is displayed as `Speaker`.
- A neutral label may refine once to `Me` or `Them` when later evidence resolves it. Pluto must not flip an already confident `Me` claim to `Them`, or the reverse.

Normalization applies Unicode compatibility normalization, lowercases text, retains apostrophes inside contractions, removes other punctuation, and excludes a versioned English stop-word set owned by the reconciler. It does not expand contractions or perform semantic rewriting. Repeated content words retain multiplicity for containment but are deduplicated for Jaccard membership. Clip activity intervals to the segment interval before calculating coverage; uncovered duration contributes to neither source. When mic- and System-dominant intervals overlap, count the overlap as System-dominant for the mic-confidence thresholds.

The reconciler may use evidence arriving up to five seconds after a segment commits. During that bounded horizon, a neutral label may refine once and a presentation duplicate may be suppressed. After the horizon expires, the displayed attribution is stable. Missing activity evidence, an empty normalized token set, or insufficient interval coverage always resolves to `Speaker` rather than a source-derived guess.

Implement this as a pure live presentation reconciler over source-tagged EOU segments and bounded capture-activity evidence. It may change labels and suppress presentation duplicates. It must not mutate recognized words, committed-prefix history, timestamps, or canonical finalization input.

### Punctuation

The pinned Parakeet EOU vocabulary contains no punctuation tokens, so raw live output cannot satisfy the reading contract by itself. Apply a deterministic presentation transform only when an EOU boundary commits:

- capitalize the first alphabetic character of a committed utterance;
- preserve punctuation already present;
- add one terminal period when the utterance has no terminal `.`, `?`, or `!`;
- leave tentative text lexically unchanged.

The transform must be idempotent and must not alter contractions, acronyms, numbers, internal casing, raw EOU snapshots, or the canonical final transcript. Exact-text or evidence views continue to use unmodified recognized text.

## Recording workspace contract

Replace the two disclosure rows at the bottom of the recording rail with one compact, always-visible participant section.

- Remove Capture diagnostics from the ordinary recording surface. Capture failures continue through the existing calm status and recovery paths.
- Remove the collapsed Meeting details disclosure and its redundant horizontal rules.
- Keep `Add a person`, participant chips, removal, Enter-to-add, focus visibility, and accessible labels visible by default.
- Keep the meeting title and locally persisted scratchpad unchanged.
- Use existing Pluto tokens, typography, control shapes, and responsive layout. Do not introduce a card, modal, or new decorative treatment.

The section should promote participant entry without competing with the conversation: one quiet label, the compact input, and chips only when participants exist.

## Back-to-back meeting lifecycle

Global recording availability is derived only from capture ownership, never from a selected meeting's transcript or analysis state.

### Capture lifecycle authority

One capture-lifecycle controller is authoritative for state, start admission, and transition reasons. The sidebar action, Command-N, unload guard, recording workspace, and `AudioManager.startSession()` consume the same immutable lifecycle snapshot and invoke the same start-admission command. No renderer component may independently infer availability from meeting processing state, and `AudioManager` may not maintain a separate processing-based start veto.

The start command returns a typed admitted or rejected result containing the lifecycle state and a content-free reason. An enabled New meeting action is acceptance evidence only when that same command admits capture and the main process successfully creates the next `AUDIO_CAPTURE_JOURNAL_START`. UI text alone is not proof of availability.

Use an explicit capture lifecycle with these meanings:

- `idle`: no capture resources are owned; New meeting is enabled.
- `starting`: recording admission is in flight; Starting meeting occupies the action.
- `recording`: capture is active; Return to recording occupies the action.
- `sealing`: capture has stopped but journal sealing and capture-resource release are not complete; Finishing meeting occupies the disabled action.

Transition to `idle` as soon as the journal is sealed, audio resources and the capture lease are released, and the saved meeting handoff is durable. Final Parakeet transcription, transcript validation, title generation, analysis, and knowledge synthesis are meeting-scoped background work and must not keep the capture lifecycle in `sealing`.

When a processing Meeting View is visible, the sidebar must show an enabled New meeting action and the Command-N shortcut. Starting the next meeting clears only the live-workspace inputs for the new session. It does not cancel, supersede, hide, or transfer the earlier meeting's persisted processing lease.

The existing Parakeet runtime lease remains the arbitration boundary. A new live lease may preempt final transcription only through its existing cancellation and durable retry handoff. Background analysis uses Ollama and does not own capture or the Parakeet live lease.

## Foreground analysis admission

The local Ollama gate must support cooperative priority preemption instead of priority ordering only.

### Gate behavior

- Every queued task has a stable key, priority, task class, and cancellation signal.
- Enqueuing foreground analysis requests cancellation of an active background knowledge-generation task.
- The gate waits for the active background request to settle before admitting foreground work.
- A task cancelled while queued is removed and can never execute later.
- Equal-priority work remains FIFO and matching stable keys continue to share one result.
- Preemption is cooperative. The gate does not mark the slot free until the provider request has actually settled.

Stable keys are composed from task class, persisted owner ID, input revision or hash, and pass or chunk identity. Retry attempts reuse the same logical key until the persisted input revision changes; unrelated requests never share a key.

The provider combines the caller signal with the gate admission signal and passes the combined signal to the Ollama transport. Background knowledge synthesis treats foreground preemption as a typed `foreground_preempted` pause, not a provider error, malformed-output retry, or terminal document failure. That outcome bypasses recursive split-and-retry logic.

Before releasing its active slot, knowledge synthesis persists a versioned resume checkpoint containing the source input hash, ordered completed chunk keys, the next chunk identity, and the partial synthesized document. Resume verifies the input hash, skips completed chunks, and continues from the next durable boundary. An input mismatch invalidates the checkpoint explicitly and restarts from the new revision; it must not merge partial output across revisions.

### Truthful progress and deadlines

There are two admission boundaries: admission to Pluto's in-process priority gate and actual admission to Ollama's model executor. Another Pluto runtime or another local client can occupy Ollama after Pluto's own gate is free. Do not equate the two.

Use Ollama's streaming response mode so the provider can observe the first response chunk. Persist a versioned, content-free foreground progress record with owner meeting ID, attempt ID, state, state-entered timestamp, completed pass count, total known pass count when available, last-progress timestamp, and retryable failure reason. The allowed state transitions are `queued → waiting_for_model → analysis → complete`, with cancellation or a typed retryable/terminal failure allowed from any active state. The downstream coordinator owns these transitions; renderer code only presents persisted state.

The Meeting View presents `waiting_for_model` as `Waiting for the local model` and `analysis` as `Preparing meeting notes`. The main process emits a content-free meeting-processing invalidation after each persisted transition and completed pass. The renderer reloads that meeting on invalidation and also performs bounded polling while an active state is visible so progress survives a missed event and app reload. Polling stops on complete, failure, cancellation, view change, or unmount.

Background cancellation inside Pluto must settle within five seconds. The Ollama capacity and prompt-evaluation wait before first response has a separate five-minute bound. If either bound expires, analysis ends in a retryable `local_model_busy` scheduler failure rather than claiming that generation is active.

The active generation deadline starts with the first response chunk. For each ordinary analysis request, calculate it as 60 seconds plus the configured output-token budget at a conservative five tokens per second, with a three-minute minimum and a 15-minute maximum. Also fail if an admitted stream produces no chunk for 30 seconds. Keep the existing longer knowledge-document ceiling. The admitted multi-pass analysis workflow has a separate 30-minute cumulative active-generation budget across its requests; gate wait and Ollama capacity wait do not consume that budget. It records progress at each completed pass so one slow request cannot erase completed topic work. The downstream lease must remain valid beyond the capacity-wait bound plus the 30-minute workflow budget and may be renewed only by persisted progress.

Cancellation must destroy the active HTTP request, response, and socket, not only abort the caller promise. Acceptance requires the server to observe the disconnect and a following foreground probe to begin within five seconds. A request owned by another local client is never killed or mislabeled as Pluto generation; Pluto waits within the capacity bound, then reports local-model busy.

Manual retry creates one new foreground request only after the prior request and any preempted background request have settled. Existing attempt caps and terminal failure persistence remain in force.

## Failure behavior

- Ambiguous live attribution stays neutral. It never guesses to avoid an empty label.
- Loss of live attribution evidence does not stop durable capture.
- Live punctuation transform failure falls back to unmodified EOU text and does not affect capture or canonical finalization.
- New meeting remains unavailable only while capture is truly starting, recording, or sealing.
- Background knowledge preemption preserves its last durable chunk boundary and does not surface as a meeting-analysis failure.
- Foreground admission or generation failure persists a content-free retryable reason and never changes recording availability. New meeting remains governed solely by the capture lifecycle.
- Logs and persisted diagnostics may contain opaque IDs, state names, durations, counters, and typed reasons only. They must not contain transcript words, normalized matching tokens, prompts, titles, participant identities, document content, or audio-derived content.

## Verification

### Red-green automated coverage

- Pure latency metrics distinguish opening silence from speech-relative recognition delay.
- Correlated boundary timing identifies PCM, native callback, projection, and renderer publication using locally measured monotonic durations without logging content or subtracting clocks across processes.
- Cross-channel matching prefers System, suppresses mic bleed, keeps mic-exclusive speech as `Me`, and leaves unresolved mic speech as `Speaker`.
- Replay fixtures cover short utterances, contractions, repeated words, partial overlap, delayed cross-channel duplicates, uncovered intervals, and missing activity evidence. Neutral attribution refines once within the evidence horizon and confident labels never flip.
- Committed EOU punctuation is deterministic, idempotent, and presentation-only; tentative and canonical text remain unchanged.
- The recording rail renders participant entry without either disclosure or redundant separator.
- Sidebar processing state returns to New meeting once capture reaches `idle`, even when the selected meeting remains in transcript or analysis processing. Sidebar, Command-N, and `AudioManager` use the same lifecycle snapshot and admission command.
- A second meeting can start while the first meeting has an active downstream lease, proven by a successful second `AUDIO_CAPTURE_JOURNAL_START` rather than rendered copy alone.
- The serialized gate cancels and settles active background work, removes cancelled queued work, admits foreground analysis next, and resumes background work afterward.
- Knowledge preemption bypasses malformed-output retries and terminal failure persistence; resume with an unchanged input hash skips completed chunks, while an input revision invalidates the checkpoint.
- Streaming Ollama transport distinguishes Pluto-gate admission, Ollama capacity wait, first response, active generation, idle stream, cancellation, and retry.
- Cancelling an active response destroys the request, response, and socket, closes the server connection, and permits the next request within five seconds.
- A simulated externally occupied Ollama slot remains `waiting_for_model` and ends as `local_model_busy`, never as generation failure.
- Persisted progress visibly transitions from waiting to analysis during one real request, updates at completed passes, and restores the same truthful state after reload.

### Runtime acceptance

Run a real Electron sequence:

1. Start a meeting and speak after a known opening silence.
2. Verify speech-relative first text, readable committed punctuation, and neutral attribution before confidence exists.
3. Add participants from the visible recording rail.
4. Finish and open the processing Meeting View.
5. Confirm the sidebar immediately offers New meeting.
6. Start and record a second meeting while the first analysis continues.
7. Confirm foreground analysis preempts background knowledge work, reaches Ollama, completes, persists, and survives reload.
8. Confirm both meetings retain their own capture, transcript, participant, notes, and downstream evidence.

Content, identities, paths, prompts, and audio remain private throughout acceptance artifacts.
