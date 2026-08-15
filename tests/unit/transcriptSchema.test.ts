import { describe, expect, it } from 'vitest';

import {
  isTranscriptJsonEffectivelyEmpty,
  parseTranscriptSegments,
} from '../../src/utils/transcript';
import {
  TRANSCRIPT_JSON_SCHEMA_VERSION,
  buildTranscriptJsonPayload,
  buildTranscriptSpeakerAttribution,
  mergeAdjacentSpeakerSegments,
  scrubTranscriptArtifacts,
} from '../../src/utils/transcriptSchema';

describe('transcriptSchema', () => {
  it('buildTranscriptJsonPayload includes schema and pipeline fields', () => {
    const payload = buildTranscriptJsonPayload(
      [{ id: '1', text: 'hi', speaker: 'Me' }],
      {
        pipelineMode: 'canonical_session_v2',
        sessionFallbackUsed: true,
        sessionFallbackReasons: ['missing_speaker'],
        canonicalSource: 'mix',
        postHydrationBleedPass: true,
        postHydrationBleedDroppedMe: 2,
        transcription: {
          backend: 'mlx_preview',
          preset: 'accuracy_first',
          model: 'medium',
          device: 'mlx',
          computeType: 'float16',
          diarization: false,
          elapsedMs: 345,
        },
        sessionFallbackTranscription: {
          backend: 'mlx_preview',
          preset: 'accuracy_first',
          model: 'large-v3',
          device: 'mlx',
          computeType: 'float32',
          canonicalSource: 'mix',
          diarization: false,
          elapsedMs: 1234,
        },
        speakerAttribution: buildTranscriptSpeakerAttribution({
          diarizationEnabled: true,
          diarizationAttempted: true,
          mappingApplied: true,
          confidence: 0.82,
        }),
        liveTranscriptResponsiveness: {
          schemaVersion: 1,
          status: 'available',
          firstTextLatencyMs: 250,
          acceptedPublicationCount: 3,
          cadenceSampleCount: 2,
          maximumUpdateGapMs: 450,
        },
        stopToValidatedLatency: {
          schemaVersion: 1,
          status: 'available',
          durationMs: 840,
        },
      },
    );
    expect(payload.schemaVersion).toBe(TRANSCRIPT_JSON_SCHEMA_VERSION);
    expect(payload.pipelineMode).toBe('canonical_session_v2');
    expect(payload.sessionFallbackUsed).toBe(true);
    expect(payload.sessionFallbackReasons).toEqual(['missing_speaker']);
    expect(payload.canonicalSource).toBe('mix');
    expect(payload.postHydrationBleedPass).toBe(true);
    expect(payload.postHydrationBleedDroppedMe).toBe(2);
    expect(payload.transcription?.backend).toBe('mlx_preview');
    expect(payload.transcription?.model).toBe('medium');
    expect(payload.sessionFallbackTranscription?.backend).toBe('mlx_preview');
    expect(payload.sessionFallbackTranscription?.elapsedMs).toBe(1234);
    expect(payload.speakerAttribution).toEqual({
      source: 'diarization',
      confidence: 0.82,
      diarizationAttempted: true,
      mappingApplied: true,
    });
    expect(payload.liveTranscriptResponsiveness).toEqual({
      schemaVersion: 1,
      status: 'available',
      firstTextLatencyMs: 250,
      acceptedPublicationCount: 3,
      cadenceSampleCount: 2,
      maximumUpdateGapMs: 450,
    });
    expect(payload.stopToValidatedLatency).toEqual({
      schemaVersion: 1,
      status: 'available',
      durationMs: 840,
    });
    expect(payload.segments).toHaveLength(1);
  });

  it('keeps responsiveness evidence optional for existing payload callers', () => {
    const payload = buildTranscriptJsonPayload([], {
      canonicalSource: 'mic',
      postHydrationBleedPass: false,
    });

    expect(payload).not.toHaveProperty('liveTranscriptResponsiveness');
    expect(payload).not.toHaveProperty('stopToValidatedLatency');
  });

  it('records diarization-backed speaker attribution trust metadata', () => {
    const attribution = buildTranscriptSpeakerAttribution({
      diarizationEnabled: true,
      diarizationAttempted: true,
      mappingApplied: true,
      confidence: 0.67,
    });

    expect(attribution).toEqual({
      source: 'diarization',
      confidence: 0.67,
      diarizationAttempted: true,
      mappingApplied: true,
    });
  });

  it('records content-free local acoustic attribution evidence', () => {
    const attribution = buildTranscriptSpeakerAttribution({
      diarizationEnabled: true,
      diarizationAttempted: true,
      mappingApplied: true,
      acousticEvidenceAttempted: true,
      confidence: 0.9,
      engineVersion: '1.13.4',
      modelChecksums: ['segmentation', 'embedding'],
      injectedLocalWindows: 1,
      falseMeEvidenceSeconds: 0,
      missedMeEvidenceSeconds: 0,
    });

    expect(attribution).toMatchObject({
      source: 'local_diarization_acoustic',
      nearEndEvidenceAttempted: true,
      engineVersion: '1.13.4',
      modelChecksums: ['segmentation', 'embedding'],
      injectedLocalWindows: 1,
      falseMeEvidenceSeconds: 0,
      missedMeEvidenceSeconds: 0,
    });
  });

  it('records explicit fallback reason when diarization confidence is too low', () => {
    const attribution = buildTranscriptSpeakerAttribution({
      diarizationEnabled: true,
      diarizationAttempted: true,
      fallbackReason: 'low confidence',
    });

    expect(attribution).toEqual({
      source: 'channel_fallback',
      confidence: 0,
      diarizationAttempted: true,
      mappingApplied: false,
      fallbackReason: 'low_confidence',
    });
  });

  it('records explicit fallback reason when diarization is disabled', () => {
    const attribution = buildTranscriptSpeakerAttribution({
      diarizationEnabled: false,
    });

    expect(attribution).toEqual({
      source: 'channel_fallback',
      confidence: 0,
      diarizationAttempted: false,
      mappingApplied: false,
      fallbackReason: 'diarization_disabled',
    });
  });

  it('parseTranscriptSegments reads v2 wrapper', () => {
    const raw = JSON.stringify(
      buildTranscriptJsonPayload([{ text: 'x', speaker: 'Them' }], {
        canonicalSource: 'mic',
        postHydrationBleedPass: false,
      }),
    );
    const segs = parseTranscriptSegments(raw);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('x');
  });

  it('isTranscriptJsonEffectivelyEmpty handles v2 empty segments', () => {
    expect(
      isTranscriptJsonEffectivelyEmpty(
        JSON.stringify(
          buildTranscriptJsonPayload([], {
            pipelineMode: 'legacy',
            canonicalSource: 'mic',
            postHydrationBleedPass: false,
          }),
        ),
      ),
    ).toBe(true);
  });

  it('stores validation lifecycle and content-free integrity evidence', () => {
    const payload = buildTranscriptJsonPayload([], {
      canonicalSource: 'mix',
      postHydrationBleedPass: false,
      lifecycleStatus: 'needs_attention',
      integrity: {
        micActivitySeconds: 40,
        systemActivitySeconds: 90,
        localTranscriptCoveredSeconds: 2,
        remoteTranscriptCoveredSeconds: 86,
        unexplainedMicSeconds: 38,
        unexplainedSystemSeconds: 4,
        collapsedPassThroughSeconds: 6,
        unresolvedAmbiguousSeconds: 0,
        reasons: ['local_speech_unaccounted'],
      },
    });

    expect(payload.lifecycleStatus).toBe('needs_attention');
    expect(payload.integrity?.reasons).toEqual(['local_speech_unaccounted']);
    expect(JSON.stringify(payload.integrity)).not.toContain('text');
  });

  describe('scrubTranscriptArtifacts', () => {
    it('removes common Whisper YouTube/hallucination phrases', () => {
      const rawText = 'Thank you for watching. Subtitles by Amara.org';
      const cleaned = scrubTranscriptArtifacts(rawText);
      expect(cleaned).toBe('');
    });

    it('preserves valid meeting speech', () => {
      const rawText = 'We need to deploy the database migration on Friday.';
      const cleaned = scrubTranscriptArtifacts(rawText);
      expect(cleaned).toBe(
        'We need to deploy the database migration on Friday.',
      );
    });
  });

  describe('mergeAdjacentSpeakerSegments', () => {
    it('combines consecutive segments from the same speaker within 1.5s gap', () => {
      const segments = [
        { id: '1', speaker: 'Me', start: 0, end: 2.0, text: 'Hey everyone.' },
        {
          id: '2',
          speaker: 'Me',
          start: 2.5,
          end: 5.0,
          text: 'Let us start the meeting.',
        },
        {
          id: '3',
          speaker: 'Them',
          start: 5.5,
          end: 8.0,
          text: 'Sounds good.',
        },
      ];
      const merged = mergeAdjacentSpeakerSegments(segments as any);
      expect(merged.length).toBe(2);
      expect(merged[0].text).toBe('Hey everyone. Let us start the meeting.');
      expect(merged[0].start).toBe(0);
      expect(merged[0].end).toBe(5.0);
    });
  });
});
