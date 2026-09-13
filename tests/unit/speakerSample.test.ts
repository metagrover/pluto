import { describe, expect, it, vi } from 'vitest';
import {
  getSpeakerSampleAvailability,
  loadSpeakerSample,
} from '../../electron/speakerSample';

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

const pcm16Wav = (amplitude: number): Uint8Array => {
  const frames = 16000 * 2;
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let index = 0; index < frames; index += 1) {
    view.setInt16(
      44 + index * 2,
      index % 2 === 0 ? amplitude : -amplitude,
      true,
    );
  }
  return bytes;
};

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
      status: 'ready',
      sample: {
        bytes: new Uint8Array([82, 73, 70, 70]),
        mimeType: 'audio/wav',
        durationSeconds: 6,
        excerpt: 'I will send the revised proposal.',
        sampleIndex: 0,
        sampleCount: 1,
        scope: 'speaker',
      },
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
    expect(result.status === 'ready' ? result.sample.bytes : null).toEqual(
      Buffer.from([82, 73, 70, 70]),
    );
  });

  it('distinguishes unavailable encrypted audio and cancellation', async () => {
    const deps = dependencies();
    deps.getMeeting.mockReturnValue({
      id: 'meeting-a',
      transcript_json: transcriptJson,
      system_audio_path: '/meetings/meeting-a/system.enc',
    });

    await expect(
      loadSpeakerSample(
        {
          meetingId: 'meeting-a',
          speaker: 'Remote Speaker 1',
          sampleIndex: 0,
        },
        {
          ...deps,
          readEncryptedSlice: vi.fn(async () => {
            throw new Error('audio_key_unavailable');
          }),
        },
      ),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'encrypted_audio_unavailable',
    });

    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    await expect(
      loadSpeakerSample(
        {
          meetingId: 'meeting-a',
          speaker: 'Remote Speaker 1',
          sampleIndex: 0,
        },
        {
          ...deps,
          readEncryptedSlice: vi.fn(async () => {
            throw abort;
          }),
        },
      ),
    ).resolves.toEqual({ status: 'unavailable', reason: 'cancelled' });
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
    expect(result).toEqual({
      status: 'ready',
      sample: expect.objectContaining({
        excerpt: 'I think I have aligned successfully.',
        sampleIndex: 0,
        sampleCount: 1,
        scope: 'remote_channel',
      }),
    });
  });

  it('keeps System-channel playback available when coarse Them spans overlap local mic spans', async () => {
    const deps = dependencies();
    deps.getMeeting.mockReturnValue({
      id: 'meeting-a',
      transcript_json: JSON.stringify({
        segments: [
          {
            speaker: 'Me',
            startTime: 28,
            endTime: 134,
            text: 'A coarse local transcript span.',
          },
          {
            speaker: 'Them',
            startTime: 109,
            endTime: 150,
            text: 'A coarse participant transcript span.',
          },
        ],
      }),
      system_audio_path: '/meetings/meeting-a/system.wav',
    });

    expect(
      getSpeakerSampleAvailability(
        { meetingId: 'meeting-a', speaker: 'Them', sampleIndex: 0 },
        deps,
      ),
    ).toEqual({
      status: 'available',
      sampleCount: 1,
      scope: 'remote_channel',
    });
    await expect(
      loadSpeakerSample(
        { meetingId: 'meeting-a', speaker: 'Them', sampleIndex: 0 },
        deps,
      ),
    ).resolves.toEqual({
      status: 'ready',
      sample: expect.objectContaining({
        durationSeconds: 8,
        scope: 'remote_channel',
      }),
    });
    expect(deps.sliceWav).toHaveBeenCalledWith(
      expect.objectContaining({ startSec: 109, durationSec: 8 }),
    );
  });

  it('skips effectively silent ranges and returns an audible later excerpt', async () => {
    const deps = dependencies();
    deps.getMeeting.mockReturnValue({
      id: 'meeting-a',
      transcript_json: JSON.stringify({
        segments: [
          { speaker: 'Them', start: 10, end: 18, text: 'First range.' },
          { speaker: 'Them', start: 30, end: 38, text: 'Audible range.' },
        ],
      }),
      system_audio_path: '/meetings/meeting-a/system.wav',
    });
    deps.readFile
      .mockResolvedValueOnce(pcm16Wav(20))
      .mockResolvedValueOnce(pcm16Wav(1000));

    const result = await loadSpeakerSample(
      { meetingId: 'meeting-a', speaker: 'Them', sampleIndex: 0 },
      deps,
    );

    expect(deps.sliceWav).toHaveBeenCalledTimes(2);
    expect(deps.sliceWav).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ startSec: 30, durationSec: 8 }),
    );
    expect(result).toEqual({
      status: 'ready',
      sample: expect.objectContaining({
        excerpt: 'Audible range.',
        sampleCount: 1,
        scope: 'remote_channel',
      }),
    });
  });

  it('distinguishes decoded silence from an unreadable excerpt', async () => {
    const deps = dependencies();
    deps.readFile.mockResolvedValue(pcm16Wav(20));

    await expect(
      loadSpeakerSample(
        {
          meetingId: 'meeting-a',
          speaker: 'Remote Speaker 1',
          sampleIndex: 0,
        },
        deps,
      ),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'no_audible_speech',
    });
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
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'source_unavailable',
    });
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
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'audio_decode_failed',
    });
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
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'audio_too_large',
    });
    expect(oversized.removeFile).toHaveBeenCalled();
  });
});
