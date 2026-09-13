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
  mixedAudioPath: '/recordings/mixed.wav',
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
    speakerEvidence: vi.fn(async () => {
      events.push('speaker-evidence');
      return {
        turns: [
          { startTime: 0, endTime: 4, cluster: 'S1' },
          { startTime: 5, endTime: 9, cluster: 'S2' },
        ],
        energyWindows: [
          { startTime: 0, endTime: 4, micRms: 0.03, systemRms: 0 },
          { startTime: 5, endTime: 9, micRms: 0, systemRms: 0.02 },
        ],
        provenance: {
          modelIdentifier: 'speaker-diarization-offline-v1',
          modelRevision: 'a'.repeat(40),
          artifactDigest: 'b'.repeat(64),
          runtimeVersion: 'fluidaudio-test',
        },
        timings: { diarizationMs: 10, energyAnalysisMs: 2, totalMs: 12 },
        windowSeconds: 0.1,
      };
    }),
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
  it('does not publish all-Me speech when the System reference capture is incomplete', async () => {
    const deps = dependencies();
    deps.transcribe.mockImplementation(async (request) =>
      result(request.source, { noSpeech: request.source === 'system' }),
    );
    const outcome = await runFinalTranscription(
      {
        ...baseInput,
        captureEvidence: {
          ...baseInput.captureEvidence,
          systemCaptureIncomplete: true,
        },
      },
      deps,
    );
    expect(outcome).toEqual({
      status: 'needs_attention',
      reasons: ['system_capture_incomplete'],
    });
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.commitCanonical).not.toHaveBeenCalled();
    expect(deps.startAnalysis).not.toHaveBeenCalled();
    expect(deps.markNeedsAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        failure: 'required_source_failed',
        reasons: ['system_capture_incomplete'],
      }),
    );
  });
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
      'speaker-evidence',
      'commit-canonical',
      'start-analysis',
    ]);
    expect(deps.speakerEvidence).toHaveBeenCalledOnce();
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
      elapsedMs: 32,
      warnings: [],
      providerVersions: ['FluidAudio-0.15.5'],
      modelBundleVersions: ['bundle-v1'],
      reconciliation: {
        policyVersion: 'cross_channel_skew_v1',
        skewApplied: false,
        estimatedOffsetMs: 0,
        anchorCount: 0,
        confidence: 0,
        droppedMicWordCount: 0,
        collapsedSequenceCount: 0,
      },
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
      speakerAttribution: {
        source: 'recovered_channel_acoustic_v2',
        diarizationAttempted: true,
        mappingApplied: true,
        nearEndEvidenceAttempted: true,
      },
    });
    const committed = await deps.commitCanonical.mock.results[0].value;
    expect(deps.startAnalysis.mock.calls[0][0].transcript).toBe(
      committed.transcript,
    );
  });

  it('carries an explicit single-remote constraint into canonical attribution', async () => {
    const deps = dependencies();

    const outcome = await runFinalTranscription(
      { ...baseInput, expectedRemoteSpeakerCount: 1 },
      deps,
    );

    expect(outcome.status).toBe('validated');
    const commit = deps.commitCanonical.mock.calls[0][0];
    expect(commit.segments.map((segment) => segment.speaker)).toEqual([
      'Me',
      'Them',
    ]);
    expect(commit.metadata.speakerAttribution).toMatchObject({
      remoteDiarization: {
        applied: false,
        fallbackReason: 'not_enough_speakers',
        speakerCountConstraint: {
          source: 'manual_participants',
          remoteSpeakerCount: 1,
        },
      },
    });
  });

  it('persists stable anonymous labels for multiple supported system speakers', async () => {
    const deps = dependencies();
    deps.transcribe.mockImplementation(async (request) => {
      if (request.source === 'mic') return result('mic');
      return {
        ...result('system'),
        segments: [
          {
            start: 5,
            end: 9,
            text: 'first remote second remote',
            words: [
              { word: 'first', start: 5, end: 5.8 },
              { word: 'remote', start: 5.8, end: 7 },
              { word: 'second', start: 7, end: 7.8 },
              { word: 'remote', start: 7.8, end: 9 },
            ],
          },
        ],
      };
    });
    deps.speakerEvidence.mockResolvedValue({
      ...(await deps.speakerEvidence()),
      turns: [
        { startTime: 5, endTime: 7, cluster: 'speaker-b' },
        { startTime: 7, endTime: 9, cluster: 'speaker-a' },
      ],
    });
    deps.speakerEvidence.mockClear();

    const outcome = await runFinalTranscription(baseInput, deps);

    expect(outcome.status).toBe('validated');
    const commit = deps.commitCanonical.mock.calls[0][0];
    expect(commit.segments.map((segment) => segment.speaker)).toEqual([
      'Me',
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
    expect(commit.metadata.speakerAttribution).toMatchObject({
      source: 'recovered_channel_acoustic_v2',
      mappingApplied: true,
      remoteDiarization: {
        attempted: true,
        input: 'system_audio',
        applied: true,
        confidence: 1,
        clusterCount: 2,
        labeledSegmentCount: 2,
      },
    });
  });

  it('uses native System energy to label words whose decoder spans include silence', async () => {
    const deps = dependencies();
    deps.transcribe.mockImplementation(async (request) =>
      request.source === 'mic'
        ? result('mic')
        : {
            ...result('system'),
            segments: [
              {
                start: 5,
                end: 10,
                text: 'first ending second ending',
                words: [
                  { word: 'first', start: 5, end: 6 },
                  { word: 'ending', start: 6, end: 8 },
                  { word: 'second', start: 8, end: 9 },
                  { word: 'ending', start: 9, end: 10 },
                ],
              },
            ],
          },
    );
    deps.speakerEvidence.mockResolvedValue({
      ...(await deps.speakerEvidence()),
      turns: [
        { startTime: 5, endTime: 6.6, cluster: 'S1' },
        { startTime: 8, endTime: 9.6, cluster: 'S2' },
      ],
      energyWindows: [
        { startTime: 0, endTime: 4, micRms: 0.03, systemRms: 0 },
        { startTime: 4, endTime: 5, micRms: 0, systemRms: 0 },
        { startTime: 5, endTime: 6.6, micRms: 0, systemRms: 0.03 },
        { startTime: 6.6, endTime: 8, micRms: 0, systemRms: 0 },
        { startTime: 8, endTime: 9.6, micRms: 0, systemRms: 0.03 },
        { startTime: 9.6, endTime: 10, micRms: 0, systemRms: 0 },
      ],
    });
    const outcome = await runFinalTranscription(baseInput, deps);
    expect(outcome.status).toBe('validated');
    const commit = deps.commitCanonical.mock.calls[0][0];
    expect(commit.segments.map((segment) => segment.speaker)).toEqual([
      'Me',
      'Remote Speaker 1',
      'Remote Speaker 2',
    ]);
    expect(commit.metadata.speakerAttribution.remoteDiarization).toMatchObject({
      applied: true,
      confidence: 1,
      clusterCount: 2,
    });
  });

  it('keeps every surviving microphone segment attributed to Me', async () => {
    const deps = dependencies();
    deps.transcribe.mockImplementation(async (request) => {
      if (request.source === 'system') return result('system');
      return {
        ...result('mic'),
        segments: [
          { start: 0, end: 2, text: 'first microphone voice' },
          { start: 2, end: 4, text: 'second microphone voice' },
        ],
      };
    });
    deps.speakerEvidence.mockResolvedValue({
      ...(await deps.speakerEvidence()),
    });
    deps.speakerEvidence.mockClear();

    const outcome = await runFinalTranscription(baseInput, deps);

    expect(outcome.status).toBe('validated');
    expect(deps.commitCanonical.mock.calls[0][0].segments).toEqual([
      expect.objectContaining({ speaker: 'Me' }),
      expect.objectContaining({ speaker: 'Me' }),
      expect.objectContaining({ speaker: 'Them' }),
    ]);
    expect(
      deps.commitCanonical.mock.calls[0][0].metadata.speakerAttribution,
    ).toMatchObject({
      source: 'recovered_channel_acoustic_v2',
      mappingApplied: true,
    });
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

  it('keeps source ownership when mixed-audio diarization clusters are unsafe', async () => {
    const deps = dependencies();
    deps.speakerEvidence.mockResolvedValue({
      turns: [{ startTime: 0, endTime: 4, cluster: 'S1' }],
      energyWindows: [
        { startTime: 0, endTime: 2, micRms: 0.03, systemRms: 0 },
        { startTime: 2, endTime: 4, micRms: 0, systemRms: 0.02 },
      ],
      provenance: {
        modelIdentifier: 'speaker-diarization-offline-v1',
        modelRevision: 'a'.repeat(40),
        artifactDigest: 'b'.repeat(64),
        runtimeVersion: 'fluidaudio-test',
      },
      timings: { diarizationMs: 10, energyAnalysisMs: 2, totalMs: 12 },
      windowSeconds: 0.1,
    });

    const outcome = await runFinalTranscription(baseInput, deps);

    expect(outcome.status).toBe('validated');
    expect(deps.speakerEvidence).toHaveBeenCalledOnce();
    expect(deps.commitCanonical).toHaveBeenCalledOnce();
    expect(deps.commitCanonical.mock.calls[0][0].segments).toEqual([
      expect.objectContaining({ speaker: 'Me' }),
      expect.objectContaining({ speaker: 'Them' }),
    ]);
    expect(
      deps.commitCanonical.mock.calls[0][0].metadata.speakerAttribution,
    ).toMatchObject({
      remoteDiarization: {
        attempted: true,
        applied: false,
        fallbackReason: 'not_enough_speakers',
      },
    });
    expect(deps.startAnalysis).toHaveBeenCalledOnce();
  });

  it('does not analyze when the generation-bound commit loses a race', async () => {
    const deps = dependencies();
    deps.commitCanonical.mockResolvedValue({ committed: false });

    const outcome = await runFinalTranscription(baseInput, deps);

    expect(outcome.status).toBe('superseded');
    expect(deps.startAnalysis).not.toHaveBeenCalled();
  });

  it('classifies a rejected canonical trust candidate as an integrity failure', async () => {
    const deps = dependencies();
    deps.commitCanonical.mockRejectedValue(
      new Error(
        'invalid_transcript_trust_candidate:final_transcription_validated:invalid_shape',
      ),
    );

    const outcome = await runFinalTranscription(baseInput, deps);

    expect(outcome).toEqual({
      status: 'needs_attention',
      reasons: ['integrity_rejected'],
    });
    expect(deps.markNeedsAttention).toHaveBeenCalledWith(
      expect.objectContaining({ failure: 'integrity_rejected' }),
    );
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

  it('passes clusterEvidence and provenance into applyRemoteSpeakerClusters so speakerCandidates reach commitCanonical', async () => {
    const deps = dependencies();
    // Return a single remote-side cluster with a real-looking embedding so
    // applyRemoteSpeakerClusters can produce candidateEvidence.
    const clusterEvidenceFake = [
      {
        cluster: 'S2',
        embedding: Array.from({ length: 192 }, (_, i) => i / 192),
        cleanChunkCount: 5,
        cleanSegmentCount: 3,
        cleanDurationSeconds: 12,
        minimumChunkSimilarity: 0.88,
        meanChunkSimilarity: 0.92,
      },
    ];
    const provenanceFake = {
      modelIdentifier: 'speaker-diarization-offline-v1',
      modelRevision: 'a'.repeat(40),
      artifactDigest: 'b'.repeat(64),
      runtimeVersion: 'fluidaudio-test',
    };
    deps.speakerEvidence.mockResolvedValueOnce({
      turns: [
        { startTime: 0, endTime: 4, cluster: 'S1' },
        { startTime: 5, endTime: 9, cluster: 'S2' },
      ],
      energyWindows: [
        { startTime: 0, endTime: 4, micRms: 0.03, systemRms: 0 },
        { startTime: 5, endTime: 9, micRms: 0, systemRms: 0.02 },
      ],
      provenance: provenanceFake,
      clusterEvidence: clusterEvidenceFake,
      timings: { diarizationMs: 10, energyAnalysisMs: 2, totalMs: 12 },
      windowSeconds: 0.1,
    });

    const outcome = await runFinalTranscription(baseInput, deps);

    expect(outcome.status).toBe('validated');
    // speakerCandidates must be present (non-empty) when clusterEvidence is wired.
    const committedWith = deps.commitCanonical.mock.calls[0][0];
    expect(committedWith.speakerCandidates).toBeDefined();
    expect(committedWith.speakerCandidates.length).toBeGreaterThan(0);
  });
});
