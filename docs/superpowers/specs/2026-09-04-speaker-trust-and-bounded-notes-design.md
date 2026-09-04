# Speaker Trust and Bounded Notes Design

## Context

Recent dual-source meetings exposed two independent reliability defects. First, microphone diarization fragmented surviving user speech into anonymous local speakers even though the microphone's other apparent voice is normally loudspeaker echo already represented by System. Second, ordinary highly segmented meetings are routed using a verbose pre-wire prompt and can fall into an open-ended hierarchy even when the encoded request is materially smaller.

This design extends issues [#725](https://github.com/metagrover/pluto/issues/725) and [#753](https://github.com/metagrover/pluto/issues/753). Raw audio, source ASR, and existing saved transcripts remain immutable evidence. Historical correction remains explicit and compare-and-save.

## Product contract

Transcript trust keeps two source-specific responsibilities separate:

1. **Microphone ownership** — remove System-correlated echo, then attribute every surviving mic segment to `Me`.
2. **Remote separation** — diarize System audio into stable anonymous participant labels.

System-correlated microphone material is evidence of echo, not an additional local participant. The recovered-channel collapse keeps raw evidence immutable, removes supported duplicates from the canonical mic projection, and preserves ambiguous simultaneous speech as unknown or rejects the candidate. System-origin speech remains remote, and System diarization may refine `Them` into deterministic `Remote Speaker N` labels.

## Attribution architecture

The native speaker-evidence request diarizes only the System recording and returns those turns with aligned mic/System energy windows. TypeScript first transcribes the channels independently, collapses System-explained mic echo, verifies remaining mic ownership through the recovered-channel gate, and finally projects System clusters onto remote segments.

Canonical finalization requires verified recovered-channel attribution. Existing `recovered_channel_acoustic_v3` records and their optional separation fields remain schema-readable for backward compatibility, but they are not eligible for downstream notes and are offered for explicit speaker-label reprocessing.

## Failure evidence

Final-transcription failures preserve their bounded reason list in the integrity envelope. This includes source-coverage and attribution reasons already calculated by the worker. The UI may continue to present calm category-level copy, but retries and diagnosis no longer collapse distinct failures into `processing_stage_failed` alone.

## Notes architecture

All capacity checks use the exact prompt after `createNotesWireRequest` encoding because that is the payload sent to the provider.

The production compact pipeline has two modes:

- **Direct:** one compact writer and one complete-document editor.
- **Bounded partitioned:** one deterministic source partition computed before inference, followed by one compact writer and one editor per leaf. Reviewed leaf documents are combined deterministically and pass the existing mechanical source and commitment checks. There is no model merge, model repair, recursive repartition, or retry loop.

The partitioned path admits at most three leaves and six total model calls. If the source cannot fit that plan, it fails before the first provider request with a precise terminal code. Meeting-analysis orchestration also applies a twelve-minute absolute deadline; provider progress cannot extend it.

## Safety and compatibility

- Existing v1/v2/v3 attribution remains readable; new processing publishes v2.
- No voiceprint, embedding, cloud speaker recognition, or automatic attendee mapping is introduced.
- Unknown or under-covered System cluster evidence falls back to `Them`; unresolved source ownership fails closed.
- User identity corrections remain meeting-scoped and reversible.
- Exact source spans, stale-run checks, stage cache identity, and transactional publication remain mandatory.
- Existing long-path implementation remains available only to explicit non-production/legacy callers; the production compact path cannot enter it.

## Acceptance

- The runtime never diarizes microphone audio.
- System-correlated mic echo is removed before canonical attribution.
- Every surviving mic segment is `Me`; only System segments can become `Remote Speaker N`.
- Existing v3 meetings are readable but cannot start notes until explicitly reprocessed.
- Failure reasons survive the renderer-to-main persistence boundary.
- A highly segmented ordinary meeting is routed from its encoded request size.
- Production compact notes make at most two calls direct or six calls partitioned.
- The production compact path cannot call model repair, model merge, or recursive repartition.
- The run terminates with a stable error at the call, plan, or wall-clock bound.
- Read-only replays report content-free trust and capacity metrics and do not modify saved meetings.
