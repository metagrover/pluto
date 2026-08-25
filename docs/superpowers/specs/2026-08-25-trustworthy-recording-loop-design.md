# Trustworthy recording loop design

**Issue:** [#664](https://github.com/metagrover/pluto/issues/664)  
**Related:** [#657](https://github.com/metagrover/pluto/issues/657), [#659](https://github.com/metagrover/pluto/issues/659), [#663](https://github.com/metagrover/pluto/issues/663)  
**Status:** Approved from direct user acceptance feedback  
**Date:** 2026-08-25

## Outcome

The recording loop feels continuous and trustworthy. New meeting acknowledges the click before local capture admission completes. The live workspace helps the user stay in the conversation rather than monitor machinery. Finish freezes the meeting duration and moves immediately to the meeting document, where transcript and notes reveal independently as persisted artifacts become ready.

## Lifecycle contract

### Starting

- Claim the existing synchronous start lock before any asynchronous readiness work.
- Publish `starting` immediately after the claim.
- Enter the recording workspace with `Starting recording`, `00:00`, and `Preparing local capture`.
- Do not expose Finish until capture is admitted.
- Clear `starting` on every success or failure path. Existing readiness failure UI remains the retry surface.

### Recording

- Start elapsed time from the accepted recording clock, not the click.
- Keep one calm status sentence and concise microphone/System indicators.
- Notes and transcript share the canvas. Notes remain writable and local; transcript keeps source, time, and confirmation state.

### Finishing

- Accept only one stop through the existing finalization boundary.
- Freeze title, notes, start, end, and duration at accepted stop.
- Replace the live workspace immediately with a document-shaped local pending view.
- State only that recording has stopped while sealing and persistence continue; do not claim audio, transcript, or analysis readiness early.
- Keep sealed capture, canonical Parakeet finalization, integrity validation, and downstream processing unchanged.
- Replace the pending view with the persisted Meeting View after provisional meeting save.

## Presentation contract

- Use a restrained product palette and existing Pluto tokens.
- Use a compact toolbar rather than a tall command strip.
- On wide windows, allocate roughly two-fifths to the scratchpad and three-fifths to the live conversation. Never compress the transcript into a fixed narrow rail.
- Keep transcript prose at 15 px, about 1.7 line height, and no more than 70 characters per line.
- Bound same-speaker presentation turns to 45 seconds or 360 to 420 characters. Preserve every canonical segment, word, timestamp, and speaker value; the grouping is presentation-only.
- Do not invent punctuation, speaker identity, or lexical cleanup. Canonical reconciliation remains #657, and the pure readability projection remains #659.

## Failure behavior

- Start failure returns to the prior workspace and uses the existing explicit readiness retry.
- Mid-recording live transcription failure does not interrupt capture.
- Finalization failure follows existing recoverable meeting persistence and retry semantics.
- Background processing never remounts the live timer after accepted stop.

## Verification

- Red-green tests for starting, recording, accepted stop, pending Meeting View, persistence handoff, and failure release.
- Pure tests prove long same-speaker runs split without dropping or mutating evidence rows.
- DOM tests prove the live workspace disappears immediately after Finish.
- Real Electron acceptance covers New meeting, live capture, Finish, local pending document, persisted Meeting View, and reload.
