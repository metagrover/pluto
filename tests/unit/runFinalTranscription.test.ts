import { describe, expect, it, vi } from 'vitest';

import { runFinalTranscription } from '../../src/services/finalTranscription/runFinalTranscription';
import type { TranscriptionResult } from '../../src/services/transcription/contracts';

const result = (
  source: 'mic' | 'system',
  options: { noSpeech?: boolean; emptySpeech?: boolean } = {},
): TranscriptionResult => {
  const start = source === 'mic' ? 0 : 5;
  const text = source === 'mic' ? 'local words' : 'remote words';
  const empty = options.noSpeech || options.emptySpeech;
  return {
    segments: empty ? [] : [{ start, end: start + 4, text }],
    language: 'en',
    duration: 10,
    vad: {
      status: options.noSpeech ? 'no_speech' : 'speech',
      speechSeconds: empty ? 0 : 4,
    },
    meta: {
      role: 'final_validation',
      engine: 'parakeet_coreml',
      model: 'parakeet-tdt-0.6b-v3',
      providerVersion: 'FluidAudio-0.15.5',
      modelBundleVersion: 'bundle-v1',
      language: 'en',
      source,
      elapsedMs: 10,
      vocabularyCount: 2,
    },
  };
};

const baseInput = {
  meetingId: 'meeting-1',
  runId: 'run-1',
  captureEvidence: { sealed: true, generation: 'generation-1' },
  recordingDurationSeconds: 10,
  micAudioPath: '/recordings/mic.wav',
  systemAudioPath: '/recordings/system.wav',
  provisionalSegments: [],
  activityWindows: [
    { startTime: 0, endTime: 4, speaker: 'Me' as const },
    { startTime: 5, endTime: 9, speaker: 'Them' as const },
  ],
  language: 'en',
  vocabulary: ['Pluto'],
};

const dependencies = () => {
  const events: string[] = [];
  return {
    events,
    claimLease: vi.fn(async () => true),
    transcribe: vi.fn(async (request: { source: 'mic' | 'system' }) => {
      events.push(`transcribe-${request.source}`);
      return result(request.source);
    }),
    probeDuration: vi.fn(async () => 10),
    commitCanonical: vi.fn(async (commit: { segments: unknown[] }) => {
      events.push('commit-canonical');
      return {
        committed: true as const,
        transcript: { segments: commit.segments },
      };
    }),
    markNeedsAttention: vi.fn(async () => undefined),
    startAnalysis: vi.fn(async () => events.push('start-analysis')),
  };
};

describe('runFinalTranscription', () => {
  it('persists unsealed evidence through a generation-bound lease', async () => {
    const deps = dependencies();

    const outcome = await runFinalTranscription(
      {
        ...baseInput,
        captureEvidence: { sealed: false, generation: 'generation-1' },
      },
      deps,
    );

    expect(outcome.status).toBe('needs_attention');
    expect(deps.claimLease).toHaveBeenCalledOnce();
    expect(deps.markNeedsAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        failure: 'evidence_unsealed',
        lease: expect.objectContaining({
          captureGeneration: 'generation-1',
        }),
      }),
    );
  });

  it('transcribes mic then system, never mix, and starts analysis after commit', async () => {
    const deps = dependencies();

    const outcome = await runFinalTranscription(baseInput, deps);

    expect(outcome.status).toBe('validated');
    expect(
      deps.transcribe.mock.calls.map(([request]) => request.source),
    ).toEqual(['mic', 'system']);
    expect(deps.events).toEqual([
      'transcribe-mic',
      'transcribe-system',
      'commit-canonical',
      'start-analysis',
    ]);
    expect(deps.commitCanonical.mock.calls[0][0].segments).toEqual([
      expect.objectContaining({ speaker: 'Me' }),
      expect.objectContaining({ speaker: 'Them' }),
    ]);
    expect(deps.commitCanonical.mock.calls[0][0].metadata).toMatchObject({
      policy: 'parakeet_final_v1',
      engine: 'parakeet_coreml',
      model: 'parakeet-tdt-0.6b-v3',
      computeType: 'int8',
      computeUnits: 'cpu_and_neural_engine',
      language: 'en',
      elapsedMs: 20,
      warnings: [],
      providerVersions: ['FluidAudio-0.15.5'],
      modelBundleVersions: ['bundle-v1'],
      sourceDetails: {
        mic: expect.objectContaining({
          outcome: 'speech',
          elapsedMs: 10,
          segmentCount: 1,
          wordCount: 2,
        }),
        system: expect.objectContaining({
          outcome: 'speech',
          elapsedMs: 10,
          segmentCount: 1,
          wordCount: 2,
        }),
      },
    });
    const committed = await deps.commitCanonical.mock.results[0].value;
    expect(deps.startAnalysis.mock.calls[0][0].transcript).toBe(
      committed.transcript,
    );
  });

  it('pauses before inference when system resources are unsafe', async () => {
    const deps = dependencies();
    const outcome = await runFinalTranscription(baseInput, {
      ...deps,
      admit: async () => ({ admitted: false, reason: 'memory_pressure' }),
    });

    expect(outcome).toEqual({
      status: 'needs_attention',
      reasons: ['memory_pressure'],
    });
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.markNeedsAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        failure: 'resource_policy_denied',
        reasons: ['memory_pressure'],
      }),
    );
  });

  it('accepts explicit no-speech for a channel with no activity', async () => {
    const deps = dependencies();
    deps.transcribe.mockImplementation(async (request) =>
      request.source === 'system'
        ? result('system', { noSpeech: true })
        : result('mic'),
    );

    const outcome = await runFinalTranscription(
      { ...baseInput, activityWindows: [baseInput.activityWindows[0]] },
      deps,
    );

    expect(outcome.status).toBe('validated');
  });

  it('rejects speech output that contains no segments', async () => {
    const deps = dependencies();
    deps.transcribe.mockImplementation(async (request) =>
      request.source === 'mic'
        ? result('mic', { emptySpeech: true })
        : result('system'),
    );

    const outcome = await runFinalTranscription(baseInput, deps);

    expect(outcome.status).toBe('needs_attention');
    expect(deps.commitCanonical).not.toHaveBeenCalled();
    expect(deps.markNeedsAttention).toHaveBeenCalledWith(
      expect.objectContaining({ failure: 'required_source_failed' }),
    );
  });

  it('retains provisional state when integrity rejects duration evidence', async () => {
    const deps = dependencies();
    deps.probeDuration.mockResolvedValue(2);

    const outcome = await runFinalTranscription(baseInput, deps);

    expect(outcome.status).toBe('needs_attention');
    expect(deps.commitCanonical).not.toHaveBeenCalled();
    expect(deps.markNeedsAttention).toHaveBeenCalledWith(
      expect.objectContaining({ failure: 'integrity_rejected' }),
    );
  });

  it('does not analyze when the generation-bound commit loses a race', async () => {
    const deps = dependencies();
    deps.commitCanonical.mockResolvedValue({ committed: false });

    const outcome = await runFinalTranscription(baseInput, deps);

    expect(outcome.status).toBe('superseded');
    expect(deps.startAnalysis).not.toHaveBeenCalled();
  });

  it('honors cancellation without committing', async () => {
    const deps = dependencies();
    const controller = new AbortController();
    controller.abort();

    const outcome = await runFinalTranscription(
      { ...baseInput, signal: controller.signal },
      deps,
    );

    expect(outcome.status).toBe('cancelled');
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.commitCanonical).not.toHaveBeenCalled();
  });

  it('releases an acquired lease when active capture cancels inference', async () => {
    const deps = dependencies();
    const controller = new AbortController();
    deps.transcribe.mockImplementation(async () => {
      controller.abort();
      throw new Error('parakeet_cancelled');
    });

    const outcome = await runFinalTranscription(
      { ...baseInput, signal: controller.signal },
      deps,
    );

    expect(outcome.status).toBe('cancelled');
    expect(deps.markNeedsAttention).toHaveBeenCalledWith(
      expect.objectContaining({ failure: 'cancelled' }),
    );
    expect(deps.commitCanonical).not.toHaveBeenCalled();
  });
});
