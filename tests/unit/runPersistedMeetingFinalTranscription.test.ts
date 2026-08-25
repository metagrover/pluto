import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Meeting } from '../../src/types';

const mocks = vi.hoisted(() => ({
  parseEvidence: vi.fn(),
  runFinal: vi.fn(),
  processDownstream: vi.fn(),
}));

vi.mock('../../src/utils/transcriptActivityEvidence', () => ({
  parseCaptureActivityEvidence: mocks.parseEvidence,
}));
vi.mock('../../src/services/finalTranscription/runFinalTranscription', () => ({
  runFinalTranscription: mocks.runFinal,
}));
vi.mock('../../src/services/processValidatedMeetingDownstream', () => ({
  processValidatedMeetingDownstream: mocks.processDownstream,
}));

import { runPersistedMeetingFinalTranscription } from '../../src/services/finalTranscription/runPersistedMeetingFinalTranscription';

describe('runPersistedMeetingFinalTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseEvidence.mockResolvedValue({
      ok: true,
      evidence: {
        digestSha256: 'digest',
        windows: [{ startTime: 0, endTime: 1, speaker: 'Me' }],
      },
    });
    mocks.processDownstream.mockResolvedValue({ status: 'complete' });
  });

  it('reconstructs sealed inputs and hands the exact canonical commit downstream', async () => {
    const meeting = {
      id: 'meeting-1',
      title: 'Meeting',
      created_at: '2026-08-15T00:00:00.000Z',
      started_at: '2026-08-15T00:00:00.000Z',
      duration_seconds: 60,
      audio_path: '/approved/mic.wav',
      system_audio_path: '/approved/system.wav',
      capture_journal_generation: 'generation-1',
      transcript_status: 'provisional',
      transcript_json: JSON.stringify({
        transcription: {
          language: 'en',
          vocabularyHintPolicyVersion: 'known-people-v1',
          vocabularyTerms: ['Known Person'],
        },
        segments: [
          { text: 'preview', startTime: 0, endTime: 1, speaker: 'Me' },
        ],
      }),
      transcript_integrity_json: JSON.stringify({
        evidenceProvenance: {
          kind: 'sealed_capture_activity_v2',
          digestSha256: 'digest',
        },
        activityEvidence: { private: 'verified by parser' },
      }),
    } as Meeting;
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'GET_TRANSCRIPTION_VOCABULARY') {
        throw new Error('persisted vocabulary must survive process restart');
      }
      if (channel === 'GET_CAPTURE_COMPUTE_POLICY') {
        return {
          thermalState: 'nominal',
          freeMemoryBytes: 8 * 1024 ** 3,
          totalMemoryBytes: 16 * 1024 ** 3,
        };
      }
      if (channel === 'COMMIT_FINAL_TRANSCRIPTION') {
        const request = args[0] as { canonicalTranscriptJson: string };
        return {
          committed: true,
          transcriptJson: request.canonicalTranscriptJson,
        };
      }
      return true;
    });
    mocks.runFinal.mockImplementation(async (input, dependencies) => {
      expect(input).toMatchObject({
        meetingId: 'meeting-1',
        captureEvidence: { sealed: true, generation: 'generation-1' },
        micAudioPath: '/approved/mic.wav',
        systemAudioPath: '/approved/system.wav',
        language: 'en',
        vocabulary: ['Known Person'],
        vocabularyPolicyVersion: 'known-people-v1',
      });
      const committed = await dependencies.commitCanonical({
        segments: [
          {
            text: 'canonical',
            startTime: 0,
            endTime: 1,
            speaker: 'Speaker',
          },
        ],
        integrity: {},
        metadata: {
          engine: 'parakeet_coreml',
          model: 'parakeet-tdt-0.6b-v3',
          computeUnits: 'cpu_and_neural_engine',
          computeType: 'int8',
          language: 'en',
          elapsedMs: 10,
          providerVersions: ['test-provider'],
          modelBundleVersions: [],
          warnings: [],
          vocabularyCount: 1,
        },
      });
      await dependencies.startAnalysis({
        meetingId: 'meeting-1',
        transcript: committed.transcript,
      });
      return { status: 'validated' };
    });

    const outcome = await runPersistedMeetingFinalTranscription(
      meeting,
      invoke,
      { runId: 'run-1' },
    );

    expect(outcome).toEqual({ status: 'validated' });
    expect(invoke).not.toHaveBeenCalledWith(
      'GET_TRANSCRIPTION_VOCABULARY',
      expect.anything(),
    );
    expect(mocks.processDownstream).toHaveBeenCalledWith('meeting-1', invoke);
    const commitCall = invoke.mock.calls.find(
      ([channel]) => channel === 'COMMIT_FINAL_TRANSCRIPTION',
    );
    const persisted = JSON.parse(
      (commitCall?.[1] as { canonicalTranscriptJson: string })
        .canonicalTranscriptJson,
    );
    expect(persisted.liveSegments).toEqual([
      { text: 'preview', startTime: 0, endTime: 1, speaker: 'Me' },
    ]);
  });
});
