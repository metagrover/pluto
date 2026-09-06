# Stable live transcript acceptance

## Scope

This checklist validates the feature-gated #670 reading projection. It does not validate personal speaker identity (#770), final diarization quality, or a claim that display cleanup improves the canonical transcript.

## Automated gates

Run from a Node-compatible `better-sqlite3` install:

```sh
pnpm exec vitest run tests/unit/liveTranscriptReconciliation.test.ts tests/unit/liveTranscriptReadingFragments.test.ts tests/unit/liveConversationProjection.test.ts tests/unit/liveConversationRollout.test.ts tests/unit/eouRendererSession.test.ts tests/unit/LiveTranscript.dom.test.tsx tests/unit/liveTranscriptPresentation.test.ts tests/unit/recordingWorkspaceModel.test.ts tests/unit/audioManagerParakeetEouWiring.test.ts tests/unit/AppRecordingNavigation.dom.test.tsx
pnpm exec tsc --noEmit
pnpm run lint
pnpm run changelog:check
```

The synthetic causal fixture must retain every original microphone word in its visible or suppressed partition, suppress all six independently supported remote spans, retain all three local interruptions, restore those ranges when evidence is removed, and produce the same range decisions when source rows or evidence arrive in reverse order.

## Electron acceptance

1. Set `stable_live_conversation_v1` to `true` before capture starts, then restart the development Electron process so the tested source bundle is active.
2. Start a loudspeaker meeting with microphone and System capture healthy. Speak several short local replies while the remote participant continues, including one deliberate repetition of a remote phrase.
3. Confirm there is one historical row stream and at most one “Listening now” container. The draft may show separate You and Call parts; it must not concatenate overlapping sources into one sentence.
4. Let wording refine for at least five minutes. Existing historical rows must not reorder. A supported correction stays in the same row and says `Updated`; a fully duplicated displayed row says `Duplicate removed`. The deliberate unsupported repetition remains visible.
5. Scroll upward, wait for corrections and new speech, and confirm the viewport does not jump to the live edge. Activate `Return to live`, expand/collapse the draft with the keyboard, and confirm focus remains on the control.
6. Disconnect or otherwise make live recognition unavailable. Historical rows remain readable, the view explains that live wording may be incomplete, and recording continues.
7. End the meeting while speech is still refining. Confirm the final committed suffix appears, the tentative container clears, capture seals, final transcription completes, and the meeting survives reload.
8. Inspect the saved transcript and generated notes. They must be based on the raw/final evidence path, not the live reading ranges or `Duplicate removed` placeholders.

## Rollback comparison

Start a separate meeting with `stable_live_conversation_v1` disabled. The legacy transcript path must render for that entire capture. Changing the setting during an active meeting must not switch either meeting between algorithms.

## Evidence to attach to #670

- Enabled and disabled screenshots from equivalent long calls.
- Content-free projector metrics: corrections, restorations, late arrivals, degraded reconciliations, draft word count, and projection duration.
- Stop/seal/final-transcription status and persisted transcript reload result.
- Any residual duplicate with the corresponding raw mic/System row IDs and timing/evidence metadata; do not attach private transcript wording unless explicitly approved.
