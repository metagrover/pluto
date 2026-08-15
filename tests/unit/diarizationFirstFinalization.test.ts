import { describe, expect, it } from 'vitest';

import {
  buildInitialValidatedMeetingPayload,
  markStopToValidatedLatencyUnavailable,
  persistAttributedTranscriptBeforeDownstream,
  persistDerivedAfterLatencyPatch,
  persistLatencyAndDerivedIntelligence,
  persistTranscriptThenRunLatencyPatchAndDownstream,
  startStopToValidatedLatencyAfterAcceptedStop,
} from '../../src/services/diarizationFirstFinalization';
import { createStopToValidatedLatencyAccumulator } from '../../src/utils/stopToValidatedLatency';

describe('persistAttributedTranscriptBeforeDownstream', () => {
  it('persists the attributed transcript before downstream intelligence', async () => {
    const order: string[] = [];
    const result = await persistAttributedTranscriptBeforeDownstream({
      persistTranscript: async () => order.push('persist'),
      runDownstream: async () => {
        order.push('downstream');
        return 'analysis';
      },
    });
    expect(order).toEqual(['persist', 'downstream']);
    expect(result).toBe('analysis');
  });

  it('does not run downstream intelligence when persistence fails', async () => {
    let downstreamRan = false;
    await expect(
      persistAttributedTranscriptBeforeDownstream({
        persistTranscript: async () => {
          throw new Error('save failed');
        },
        runDownstream: async () => {
          downstreamRan = true;
        },
      }),
    ).rejects.toThrow('save failed');
    expect(downstreamRan).toBe(false);
  });
});

describe('stop-to-validated persistence orchestration', () => {
  it('starts latency only for an accepted stop', () => {
    const rejected = createStopToValidatedLatencyAccumulator();
    const accepted = createStopToValidatedLatencyAccumulator();

    expect(
      startStopToValidatedLatencyAfterAcceptedStop({
        acceptedStop: null,
        accumulator: rejected,
        nowMs: 100,
      }),
    ).toBe(false);
    expect(rejected.snapshot()).toBeNull();

    expect(
      startStopToValidatedLatencyAfterAcceptedStop({
        acceptedStop: { meetingId: 'meeting-1' },
        accumulator: accepted,
        nowMs: 100,
      }),
    ).toBe(true);
    expect(accepted.completeValidatedSave(145).summary).toMatchObject({
      status: 'available',
      durationMs: 45,
    });
  });

  it('waits for transcript durability before starting patch and downstream concurrently', async () => {
    const order: string[] = [];
    const accumulator = createStopToValidatedLatencyAccumulator();
    accumulator.acceptStop(100);
    let acknowledgeTranscript!: () => void;
    let acknowledgePatch!: () => void;
    const transcriptGate = new Promise<void>((resolve) => {
      acknowledgeTranscript = resolve;
    });
    const patchGate = new Promise<void>((resolve) => {
      acknowledgePatch = resolve;
    });

    const resultPromise = persistTranscriptThenRunLatencyPatchAndDownstream({
      persistTranscript: async () => {
        order.push('transcript:start');
        await transcriptGate;
        order.push('transcript:ack');
      },
      patchLatency: async () => {
        accumulator.completeValidatedSave(145);
        order.push('patch:start');
        await patchGate;
        return 'updated';
      },
      runDownstream: async () => {
        order.push('downstream:start');
        return 'analysis';
      },
    });

    await Promise.resolve();
    expect(order).toEqual(['transcript:start']);
    expect(accumulator.snapshot()).toBeNull();
    acknowledgeTranscript();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([
      'transcript:start',
      'transcript:ack',
      'patch:start',
      'downstream:start',
    ]);
    expect(accumulator.snapshot()).toMatchObject({
      status: 'available',
      durationMs: 45,
    });
    acknowledgePatch();
    await expect(resultPromise).resolves.toEqual({
      patchOutcome: 'updated',
      downstream: 'analysis',
    });
  });

  it('maps a rejected latency patch to failed and awaits downstream intelligence', async () => {
    let finishDownstream!: () => void;
    const downstreamGate = new Promise<void>((resolve) => {
      finishDownstream = resolve;
    });
    let settled = false;

    const resultPromise = persistLatencyAndDerivedIntelligence({
      patchLatency: async () => {
        throw new Error('metric IPC rejected');
      },
      runDownstream: async () => {
        await downstreamGate;
        return 'analysis';
      },
    });
    void resultPromise.finally(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    finishDownstream();
    await expect(resultPromise).resolves.toEqual({
      patchOutcome: 'failed',
      downstream: 'analysis',
    });
  });

  it('preserves the validated generation when the metric IPC rejects', async () => {
    const savedGenerations: Array<{ status: string; segments: unknown[] }> = [];
    let recoverySaveRan = false;
    let derivedSaveRan = false;
    let patchOutcome: 'failed' | undefined;

    try {
      const result = await persistTranscriptThenRunLatencyPatchAndDownstream({
        persistTranscript: async () => {
          savedGenerations.push({
            status: 'validated',
            segments: [{ speaker: 'Me', text: 'Preserve me' }],
          });
        },
        patchLatency: async () => {
          throw new Error('metric IPC rejected');
        },
        runDownstream: async () => 'analysis',
      });
      patchOutcome =
        result.patchOutcome === 'failed' ? result.patchOutcome : undefined;
      await persistDerivedAfterLatencyPatch({
        patchOutcome: result.patchOutcome,
        persistDerived: async () => {
          derivedSaveRan = true;
        },
      });
    } catch {
      recoverySaveRan = true;
      savedGenerations.push({ status: 'needs_attention', segments: [] });
    }

    expect(patchOutcome).toBe('failed');
    expect(derivedSaveRan).toBe(false);
    expect(recoverySaveRan).toBe(false);
    expect(savedGenerations).toEqual([
      {
        status: 'validated',
        segments: [{ speaker: 'Me', text: 'Preserve me' }],
      },
    ]);
  });

  it.each(['conflict', 'missing', 'failed'] as const)(
    'suppresses derived persistence after metric %s',
    async (patchOutcome) => {
      let persisted = false;
      await expect(
        persistDerivedAfterLatencyPatch({
          patchOutcome,
          persistDerived: async () => {
            persisted = true;
            return 'updated';
          },
        }),
      ).resolves.toEqual({ outcome: 'suppressed' });
      expect(persisted).toBe(false);
    },
  );

  it.each(['updated', 'already_current'] as const)(
    'persists derived fields after metric %s',
    async (patchOutcome) => {
      await expect(
        persistDerivedAfterLatencyPatch({
          patchOutcome,
          persistDerived: async () => 'updated' as const,
        }),
      ).resolves.toEqual({ outcome: 'persisted', result: 'updated' });
    },
  );

  it('classifies a rejected derived IPC as failed and preserves the validated generation', async () => {
    const savedGenerations: Array<{
      status: string;
      segments: unknown[];
      integrity: { reasons: string[] };
    }> = [];
    let recoverySaveRan = false;
    let derivedOutcome: 'failed' | undefined;

    try {
      savedGenerations.push({
        status: 'validated',
        segments: [{ speaker: 'Me', text: 'Validated evidence' }],
        integrity: { reasons: [] },
      });
      const result = await persistDerivedAfterLatencyPatch({
        patchOutcome: 'updated',
        persistDerived: async () => {
          throw new Error('derived IPC rejected');
        },
      });
      derivedOutcome = result.outcome === 'failed' ? result.outcome : undefined;
    } catch {
      recoverySaveRan = true;
      savedGenerations.push({
        status: 'needs_attention',
        segments: [],
        integrity: { reasons: ['required_source_failed'] },
      });
    }

    expect(derivedOutcome).toBe('failed');
    expect(recoverySaveRan).toBe(false);
    expect(savedGenerations).toEqual([
      {
        status: 'validated',
        segments: [{ speaker: 'Me', text: 'Validated evidence' }],
        integrity: { reasons: [] },
      },
    ]);
  });

  it.each([
    ['needs_attention', 'not_validated'],
    ['recovery_required', 'recovery_required'],
    ['validated_save_failed', 'validated_save_failed'],
  ] as const)('maps %s to unavailable reason %s', (outcome, reason) => {
    const accumulator = createStopToValidatedLatencyAccumulator();
    accumulator.acceptStop(100);

    expect(markStopToValidatedLatencyUnavailable(accumulator, outcome)).toEqual(
      {
        schemaVersion: 1,
        status: 'unavailable',
        reason,
      },
    );
  });

  it('builds the participant-bearing first save with complete non-derived provenance', async () => {
    const firstSave = buildInitialValidatedMeetingPayload({
      meeting: {
        id: 'meeting-first-save',
        title: 'Meeting',
        transcript_status: 'validated',
        transcript_validated_at: '2026-07-30T08:00:00.000Z',
        user_notes: 'User note',
        audio_path: '/audio/mic.wav',
        system_audio_path: '/audio/system.wav',
        mixed_audio_path: '/audio/mix.wav',
      },
      segments: [{ speaker: 'Me', text: 'Hello', start: 0, end: 1 }],
      transcriptMetadata: {
        pipelineMode: 'canonical_session_v2',
        sessionFallbackUsed: true,
        sessionFallbackReasons: ['required_source_failed'],
        canonicalSource: 'mix',
        postHydrationBleedPass: true,
        postHydrationBleedDroppedMe: 1,
        transcription: {
          backend: 'mlx_preview',
          preset: 'balanced',
          model: 'large-v3-turbo',
          device: 'mlx',
          computeType: 'float16',
          diarization: false,
          elapsedMs: 12,
        },
        sessionFallbackTranscription: {
          backend: 'mlx_preview',
          preset: 'balanced',
          model: 'large-v3-turbo',
          device: 'mlx',
          computeType: 'float16',
          diarization: true,
          elapsedMs: 25,
          canonicalSource: 'mix',
        },
        speakerAttribution: {
          source: 'local_diarization_acoustic',
          confidence: 0.98,
          diarizationAttempted: true,
          mappingApplied: true,
        },
        liveTranscriptResponsiveness: {
          schemaVersion: 1,
          status: 'available',
          firstTextLatencyMs: 10,
          acceptedPublicationCount: 1,
          cadenceSampleCount: 0,
          maximumUpdateGapMs: 0,
        },
        lifecycleStatus: 'validated',
        integrity: { reasons: [] },
      },
      participants: ['Ada', 'Grace'],
    });
    const persisted: Array<Record<string, unknown>> = [];

    await persistTranscriptThenRunLatencyPatchAndDownstream({
      persistTranscript: async () => {
        persisted.push(firstSave);
      },
      patchLatency: async () => 'updated',
      runDownstream: async () => 'analysis',
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      participants: ['Ada', 'Grace'],
      enhanced_notes: null,
      analysis_json: null,
      value_signals_json: null,
      finalization_status: 'finalized',
      finalization_error_category: null,
    });
    expect(JSON.parse(String(persisted[0]?.transcript_json))).toMatchObject({
      schemaVersion: 2,
      pipelineMode: 'canonical_session_v2',
      sessionFallbackUsed: true,
      sessionFallbackReasons: ['required_source_failed'],
      canonicalSource: 'mix',
      transcription: {
        backend: 'mlx_preview',
        preset: 'balanced',
        model: 'large-v3-turbo',
      },
      sessionFallbackTranscription: {
        backend: 'mlx_preview',
        canonicalSource: 'mix',
      },
      speakerAttribution: {
        source: 'local_diarization_acoustic',
        mappingApplied: true,
      },
      liveTranscriptResponsiveness: { status: 'available' },
      lifecycleStatus: 'validated',
      segments: [{ speaker: 'Me', text: 'Hello' }],
    });
  });
});
