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
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'GET_TRANSCRIPTION_VOCABULARY') {
        return { terms: ['Known Person'] };
      }
      if (channel === 'GET_CAPTURE_COMPUTE_POLICY') {
        return {
          thermalState: 'nominal',
          freeMemoryBytes: 8 * 1024 ** 3,
          totalMemoryBytes: 16 * 1024 ** 3,
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
      await dependencies.startAnalysis({
        meetingId: 'meeting-1',
        transcript: { segments: [{ text: 'canonical' }] },
      });
      return { status: 'validated' };
    });

    const outcome = await runPersistedMeetingFinalTranscription(
      meeting,
      invoke,
      { runId: 'run-1' },
    );

    expect(outcome).toEqual({ status: 'validated' });
    expect(mocks.processDownstream).toHaveBeenCalledWith('meeting-1', invoke);
  });
});
