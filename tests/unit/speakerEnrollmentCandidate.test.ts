import { describe, expect, it, vi } from 'vitest';
import { buildSpeakerEnrollmentCandidate } from '../../electron/speakerEnrollmentCandidate';

const provenance = {
  modelIdentifier: 'speaker-diarization-offline-v1',
  modelRevision: 'a'.repeat(40),
  artifactDigest: 'b'.repeat(64),
  runtimeVersion: 'fluidaudio-test',
  profileAlgorithmVersion: 'v1',
};

describe('buildSpeakerEnrollmentCandidate', () => {
  it('derives enrollment evidence from the same two system-audio samples as review', async () => {
    const createAudio = vi.fn(async () => ({
      systemPath: '/recordings/work/system.wav',
      micPath: '/recordings/work/mic.wav',
      totalDurationSeconds: 10,
    }));
    const analyze = vi.fn(async () => ({
      turns: [{ startTime: 0, endTime: 10, cluster: 'S1' }],
      energyWindows: [
        { startTime: 0, endTime: 0.1, micRms: 0, systemRms: 0.1 },
      ],
      provenance,
      timings: { diarizationMs: 1, energyAnalysisMs: 1, totalMs: 2 },
      windowSeconds: 0.1,
      clusterEvidence: [
        {
          cluster: 'S1',
          embedding: new Array(256).fill(1 / 16),
          cleanChunkCount: 3,
          cleanSegmentCount: 2,
          cleanDurationSeconds: 9,
          minimumChunkSimilarity: 0.82,
          meanChunkSimilarity: 0.9,
        },
      ],
    }));
    const removeWorkDir = vi.fn(async () => undefined);

    const result = await buildSpeakerEnrollmentCandidate(
      { meetingId: 'meeting-1', speaker: 'Them' },
      {
        getMeeting: () => ({
          id: 'meeting-1',
          transcript_status: 'validated',
          capture_journal_generation: 'generation-1',
          system_audio_path: '/recordings/full.wav',
          transcript_json: JSON.stringify([
            { speaker: 'Them', text: 'First sample', start: 10, end: 15 },
            { speaker: 'Them', text: 'Second sample', start: 30, end: 34 },
          ]),
        }),
        fileExists: () => true,
        createWorkDir: () => '/recordings/work',
        removeWorkDir,
        createAudio,
        analyze,
      },
    );

    expect(createAudio).toHaveBeenCalledWith({
      sourcePath: '/recordings/full.wav',
      intervals: [
        { startSec: 10, endSec: 15, excerpt: 'First sample' },
        { startSec: 30, endSec: 34, excerpt: 'Second sample' },
      ],
      outputDir: '/recordings/work',
    });
    expect(analyze).toHaveBeenCalledWith({
      mixedAudioPath: '/recordings/work/system.wav',
      micAudioPath: '/recordings/work/mic.wav',
      systemAudioPath: '/recordings/work/system.wav',
    });
    expect(result).toMatchObject({
      sourceRevision: 'generation-1',
      candidate: { speaker: 'Them', isEligibleForEnrollment: true },
    });
    expect(removeWorkDir).toHaveBeenCalledWith('/recordings/work');
  });

  it('fails closed when two review samples are unavailable', async () => {
    const createAudio = vi.fn();
    const result = await buildSpeakerEnrollmentCandidate(
      { meetingId: 'meeting-1', speaker: 'Them' },
      {
        getMeeting: () => ({
          id: 'meeting-1',
          transcript_status: 'validated',
          capture_journal_generation: 'generation-1',
          system_audio_path: '/recordings/full.wav',
          transcript_json: JSON.stringify([
            { speaker: 'Them', text: 'Only sample', start: 10, end: 15 },
          ]),
        }),
        fileExists: () => true,
        createWorkDir: () => '/recordings/work',
        removeWorkDir: async () => undefined,
        createAudio,
        analyze: vi.fn(),
      },
    );

    expect(result).toBeNull();
    expect(createAudio).not.toHaveBeenCalled();
  });
});
