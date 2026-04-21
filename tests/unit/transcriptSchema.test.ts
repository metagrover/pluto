import { describe, expect, it } from 'vitest';

import {
  isTranscriptJsonEffectivelyEmpty,
  parseTranscriptSegments,
} from '../../src/utils/transcript';
import {
  TRANSCRIPT_JSON_SCHEMA_VERSION,
  buildTranscriptJsonPayload,
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
          backend: 'whisperx_current',
          preset: 'accuracy_first',
          model: 'medium',
          device: 'cpu',
          computeType: 'int8',
          diarization: false,
          elapsedMs: 345,
        },
        sessionFallbackTranscription: {
          backend: 'whisperx_tuned',
          preset: 'accuracy_first',
          model: 'large-v3',
          device: 'cpu',
          computeType: 'float32',
          canonicalSource: 'mix',
          diarization: false,
          elapsedMs: 1234,
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
    expect(payload.transcription?.backend).toBe('whisperx_current');
    expect(payload.transcription?.model).toBe('medium');
    expect(payload.sessionFallbackTranscription?.backend).toBe(
      'whisperx_tuned',
    );
    expect(payload.sessionFallbackTranscription?.elapsedMs).toBe(1234);
    expect(payload.segments).toHaveLength(1);
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
});
