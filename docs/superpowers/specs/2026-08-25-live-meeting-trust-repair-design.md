# Live meeting trust repair design

**Issues:** [#663](https://github.com/metagrover/pluto/issues/663), [#664](https://github.com/metagrover/pluto/issues/664), [#647](https://github.com/metagrover/pluto/issues/647)  
**Related:** [#659](https://github.com/metagrover/pluto/issues/659)  
**Status:** Approved from direct Aug 25 live acceptance feedback  
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

Add boundary timing for first causal PCM frame, first native partial callback, first accepted projection, and first renderer publication. A private causal replay and a real recording must identify the boundary responsible for any speech-relative delay. The repair must address that boundary directly. It must not use an artificial timer, invented transcript text, or a durable journal receipt as live input.

For ordinary continuous English speech, the acceptance target is first visible text within three seconds of first detected speech. Silence before speech does not count as recognition delay.

### Speaker confidence

Live EOU output remains source-tagged, but source identity alone is not a displayed speaker claim.

- A committed System segment is confidently `Them`.
- A mic segment becomes `Me` only when at least 60 percent of its timed duration is covered by mic-dominant activity, no more than 15 percent is covered by System-dominant activity, and no overlapping System hypothesis contains materially matching words.
- Treat hypotheses as materially matching when their timed intervals are within two seconds and either they share at least four normalized content words with Jaccard similarity of at least 0.72, or a three-word shorter hypothesis is fully contained in the longer hypothesis.
- When materially matching speech appears on mic and System, prefer the System segment and suppress the mic duplicate from presentation.
- A mic segment without enough exclusive or cross-channel evidence is displayed as `Speaker`.
- A neutral label may refine once to `Me` or `Them` when later evidence resolves it. Pluto must not flip an already confident `Me` claim to `Them`, or the reverse.

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

The provider combines the caller signal with the gate admission signal and passes the combined signal to the Ollama transport. Background knowledge synthesis treats foreground preemption as a pause, not a malformed-output retry. It checkpoints at its existing chunk boundary and resumes only after the foreground pause is released.

### Truthful progress and deadlines

There are two admission boundaries: admission to Pluto's in-process priority gate and actual admission to Ollama's model executor. Another Pluto runtime or another local client can occupy Ollama after Pluto's own gate is free. Do not equate the two.

Use Ollama's streaming response mode so the provider can observe the first response chunk. Persist content-free foreground progress as `waiting_for_model` until that first chunk and `analysis` afterward. The Meeting View presents these as `Waiting for the local model` and `Preparing meeting notes` respectively.

Background cancellation inside Pluto must settle within five seconds. The Ollama capacity and prompt-evaluation wait before first response has a separate five-minute bound. If either bound expires, analysis ends in a retryable `local_model_busy` scheduler failure rather than claiming that generation is active.

The active generation deadline starts with the first response chunk. For ordinary analysis tasks, calculate it as 60 seconds plus the configured output-token budget at a conservative five tokens per second, with a three-minute minimum and a 15-minute maximum. Also fail if an admitted stream produces no chunk for 30 seconds. Keep the existing longer knowledge-document ceiling. The admitted multi-pass analysis workflow has a 30-minute overall active-generation budget and records progress at each completed pass so one slow request cannot erase completed topic work.

Cancellation must destroy the active HTTP response and socket, not only abort the caller promise. Acceptance requires the server to observe the disconnect and a following foreground probe to begin within five seconds. A request owned by another local client is never killed or mislabeled as Pluto generation; Pluto waits within the capacity bound, then reports local-model busy.

Manual retry creates one new foreground request only after the prior request and any preempted background request have settled. Existing attempt caps and terminal failure persistence remain in force.

## Failure behavior

- Ambiguous live attribution stays neutral. It never guesses to avoid an empty label.
- Loss of live attribution evidence does not stop durable capture.
- Live punctuation transform failure falls back to unmodified EOU text and does not affect capture or canonical finalization.
- New meeting remains unavailable only while capture is truly starting, recording, or sealing.
- Background knowledge preemption preserves its last durable chunk boundary and does not surface as a meeting-analysis failure.
- Foreground admission or generation failure persists a content-free retryable reason and restores the New meeting action.

## Verification

### Red-green automated coverage

- Pure latency metrics distinguish opening silence from speech-relative recognition delay.
- Boundary timing identifies PCM, native callback, projection, and renderer publication without logging content.
- Cross-channel matching prefers System, suppresses mic bleed, keeps mic-exclusive speech as `Me`, and leaves unresolved mic speech as `Speaker`.
- Neutral attribution refines once and confident labels never flip.
- Committed EOU punctuation is deterministic, idempotent, and presentation-only; tentative and canonical text remain unchanged.
- The recording rail renders participant entry without either disclosure or redundant separator.
- Sidebar processing state returns to New meeting once capture reaches `idle`, even when the selected meeting remains in transcript or analysis processing.
- A second meeting can start while the first meeting has an active downstream lease.
- The serialized gate cancels and settles active background work, removes cancelled queued work, admits foreground analysis next, and resumes background work afterward.
- Streaming Ollama transport distinguishes Pluto-gate admission, Ollama capacity wait, first response, active generation, idle stream, cancellation, and retry.
- Cancelling an active response closes the server connection and permits the next request within five seconds.
- A simulated externally occupied Ollama slot remains `waiting_for_model` and ends as `local_model_busy`, never as generation failure.

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
