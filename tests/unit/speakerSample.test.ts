import { describe, expect, it, vi } from 'vitest';
import { loadSpeakerSample } from '../../electron/speakerSample';

const transcriptJson = JSON.stringify({
  segments: [
    {
      speaker: 'Remote Speaker 1',
      start: 10,
      end: 16,
      text: 'I will send the revised proposal.',
    },
    {
      speaker: 'Remote Speaker 2',
      start: 20,
      end: 26,
      text: 'A different person responds.',
    },
  ],
});

const dependencies = () => ({
  getMeeting: vi.fn(() => ({
    id: 'meeting-a',
    transcript_json: transcriptJson,
    system_audio_path: '/meetings/meeting-a/system.wav',
  })),
  fileExists: vi.fn(() => true),
  createTemporaryPath: vi.fn(() => '/tmp/speaker-sample.wav'),
  sliceWav: vi.fn(async () => true),
  readFile: vi.fn(async () => new Uint8Array([82, 73, 70, 70])),
  removeFile: vi.fn(async () => undefined),
});

describe('meeting speaker samples', () => {
  it('resolves a bounded sample from the persisted System artifact', async () => {
    const deps = dependencies();

    const result = await loadSpeakerSample(
      {
        meetingId: 'meeting-a',
        speaker: 'Remote Speaker 1',
        sampleIndex: 0,
      },
      deps,
    );

    expect(deps.sliceWav).toHaveBeenCalledWith({
      inputPath: '/meetings/meeting-a/system.wav',
      outputPath: '/tmp/speaker-sample.wav',
      startSec: 10,
      durationSec: 6,
    });
    expect(result).toEqual({
      bytes: new Uint8Array([82, 73, 70, 70]),
      mimeType: 'audio/wav',
      durationSeconds: 6,
      excerpt: 'I will send the revised proposal.',
      sampleIndex: 0,
      sampleCount: 1,
    });
    expect(deps.removeFile).toHaveBeenCalledWith('/tmp/speaker-sample.wav');
  });

  it('returns an authenticated in-memory slice for encrypted audio', async () => {
    const deps = dependencies();
    deps.getMeeting.mockReturnValue({
      id: 'meeting-a',
      transcript_json: transcriptJson,
      system_audio_path: '/meetings/meeting-a/system.enc',
    });
    const readEncryptedSlice = vi.fn(async () => Buffer.from([82, 73, 70, 70]));

    const result = await loadSpeakerSample(
      {
        meetingId: 'meeting-a',
        speaker: 'Remote Speaker 1',
        sampleIndex: 0,
      },
      { ...deps, readEncryptedSlice },
    );

    expect(readEncryptedSlice).toHaveBeenCalledWith({
      meetingId: 'meeting-a',
      inputPath: '/meetings/meeting-a/system.enc',
      startSec: 10,
      durationSec: 6,
    });
    expect(deps.createTemporaryPath).not.toHaveBeenCalled();
    expect(deps.sliceWav).not.toHaveBeenCalled();
    expect(result?.bytes).toEqual(Buffer.from([82, 73, 70, 70]));
  });

  it('resolves a bounded sample for the aggregate Them speaker', async () => {
    const deps = dependencies();
    deps.getMeeting.mockReturnValue({
      id: 'meeting-a',
      transcript_json: JSON.stringify({
        segments: [
          {
            speaker: 'Them',
            start: 96.88,
            end: 101.2,
            text: 'I think I have aligned successfully.',
          },
        ],
      }),
      system_audio_path: '/meetings/meeting-a/system.wav',
    });

    const result = await loadSpeakerSample(
      {
        meetingId: 'meeting-a',
        speaker: 'Them',
        sampleIndex: 0,
      },
      deps,
    );

    expect(deps.sliceWav).toHaveBeenCalledWith({
      inputPath: '/meetings/meeting-a/system.wav',
      outputPath: '/tmp/speaker-sample.wav',
      startSec: 96.88,
      durationSec: expect.closeTo(4.32, 6),
    });
    expect(result).toEqual(
      expect.objectContaining({
        excerpt: 'I think I have aligned successfully.',
        sampleIndex: 0,
        sampleCount: 1,
      }),
    );
  });

  it.each([
    { meetingId: '', speaker: 'Remote Speaker 1', sampleIndex: 0 },
    { meetingId: 'meeting-a', speaker: 'Speaker 1', sampleIndex: 0 },
    { meetingId: 'meeting-a', speaker: 'Remote Speaker 1', sampleIndex: 2 },
  ])('rejects an invalid shaped request', async (request) => {
    const deps = dependencies();
    await expect(loadSpeakerSample(request, deps)).rejects.toThrow(
      'speaker_sample_request_invalid',
    );
    expect(deps.getMeeting).not.toHaveBeenCalled();
  });

  it('returns null without slicing when the saved System artifact is unavailable', async () => {
    const deps = dependencies();
    deps.fileExists.mockReturnValue(false);

    await expect(
      loadSpeakerSample(
        {
          meetingId: 'meeting-a',
          speaker: 'Remote Speaker 1',
          sampleIndex: 0,
        },
        deps,
      ),
    ).resolves.toBeNull();
    expect(deps.sliceWav).not.toHaveBeenCalled();
  });

  it('cleans up failed and oversized temporary samples', async () => {
    const failed = dependencies();
    failed.sliceWav.mockResolvedValue(false);
    await expect(
      loadSpeakerSample(
        {
          meetingId: 'meeting-a',
          speaker: 'Remote Speaker 1',
          sampleIndex: 0,
        },
        failed,
      ),
    ).resolves.toBeNull();
    expect(failed.removeFile).toHaveBeenCalled();

    const oversized = dependencies();
    oversized.readFile.mockResolvedValue(new Uint8Array(10 * 1024 * 1024 + 1));
    await expect(
      loadSpeakerSample(
        {
          meetingId: 'meeting-a',
          speaker: 'Remote Speaker 1',
          sampleIndex: 0,
        },
        oversized,
      ),
    ).resolves.toBeNull();
    expect(oversized.removeFile).toHaveBeenCalled();
  });
});
