# Speaker Trust and Bounded Notes Design

## Context

Recent dual-source meetings exposed two independent reliability defects. First, a microphone recording can contain more than the workspace user. The recovered-channel pipeline nevertheless treats microphone origin as sufficient identity evidence and reports confidence from labeled duration. Second, ordinary highly segmented meetings are routed using a verbose pre-wire prompt and can fall into an open-ended hierarchy even when the encoded request is materially smaller.

This design extends issues [#725](https://github.com/metagrover/pluto/issues/725) and [#753](https://github.com/metagrover/pluto/issues/753). Raw audio, source ASR, and existing saved transcripts remain immutable evidence. Historical correction remains explicit and compare-and-save.

## Product contract

Transcript trust has three independent dimensions:

1. **Content completeness** — the required recorded speech is represented.
2. **Speaker separation** — distinct detected voices are not collapsed into one label.
3. **Self identity** — one separated speaker is independently known to be the workspace user.

Notes require content completeness and speaker separation. They do not require self identity. Any ownership or person binding that depends on self identity continues to abstain until a user supplies a meeting-scoped identity correction.

When the microphone contains multiple supported diarization clusters, Pluto stores deterministic `Local Speaker N` labels ordered by first occurrence. It does not select one cluster as `Me`. These labels flow through the existing Speaker identities control, which can map a meeting-local label to a person without rewriting acoustic evidence.

Single-speaker microphone recordings retain the current recovered-channel behavior. System-origin speech remains remote, and System diarization may continue to refine `Them` into deterministic `Remote Speaker N` labels.

## Attribution architecture

The native speaker-evidence request diarizes the microphone and System recordings independently and returns both turn sets with the existing aligned energy windows. The TypeScript finalizer first projects supported microphone clusters, then applies recovered-channel echo and activity rules, then projects System clusters.

`StoredTranscriptSpeakerAttribution` records separation and identity states explicitly. `mappingApplied` retains its existing meaning: an identity mapping was actually applied. A multi-speaker microphone transcript may therefore be safe for notes while `mappingApplied` is false and self identity is unresolved.

The canonical integrity envelope keeps `speakerAttributionVerified` for compatibility and adds `speakerSeparationVerified`. Finalization may commit only when content validation passes and speaker separation is verified. Downstream notes use the same separation predicate. Capture-backed owner identity continues to require verified identity, not merely separation.

## Failure evidence

Final-transcription failures preserve their bounded reason list in the integrity envelope. This includes source-coverage and attribution reasons already calculated by the worker. The UI may continue to present calm category-level copy, but retries and diagnosis no longer collapse distinct failures into `processing_stage_failed` alone.

## Notes architecture

All capacity checks use the exact prompt after `createNotesWireRequest` encoding because that is the payload sent to the provider.

The production compact pipeline has two modes:

- **Direct:** one compact writer and one complete-document editor.
- **Bounded partitioned:** one deterministic source partition computed before inference, followed by one compact writer and one editor per leaf. Reviewed leaf documents are combined deterministically and pass the existing mechanical source and commitment checks. There is no model merge, model repair, recursive repartition, or retry loop.

The partitioned path admits at most three leaves and six total model calls. If the source cannot fit that plan, it fails before the first provider request with a precise terminal code. Meeting-analysis orchestration also applies a twelve-minute absolute deadline; provider progress cannot extend it.

## Safety and compatibility

- Existing v1/v2 attribution remains readable.
- No voiceprint, embedding, cloud speaker recognition, or automatic attendee mapping is introduced.
- Unknown or under-covered cluster evidence fails closed.
- User identity corrections remain meeting-scoped and reversible.
- Exact source spans, stale-run checks, stage cache identity, and transactional publication remain mandatory.
- Existing long-path implementation remains available only to explicit non-production/legacy callers; the production compact path cannot enter it.

## Acceptance

- Two supported microphone clusters never commit as a single `Me` identity.
- Multi-speaker microphone transcripts can commit with verified separation and unresolved self identity.
- Notes can start from that transcript, while capture-backed person identity remains unavailable.
- Failure reasons survive the renderer-to-main persistence boundary.
- A highly segmented ordinary meeting is routed from its encoded request size.
- Production compact notes make at most two calls direct or six calls partitioned.
- The production compact path cannot call model repair, model merge, or recursive repartition.
- The run terminates with a stable error at the call, plan, or wall-clock bound.
- Read-only replays report content-free trust and capacity metrics and do not modify saved meetings.
