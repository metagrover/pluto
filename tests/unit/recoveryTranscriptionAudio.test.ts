import { describe, expect, it, vi } from 'vitest';

import {
  normalizeCheckpointWords,
  transcribeJournalAlignedAudio,
} from '../../electron/recoveryTranscriptionAudio';

describe('normalizeCheckpointWords', () => {
  it('keeps valid words and drops only malformed optional word timings', () => {
    expect(
      normalizeCheckpointWords(
        [
          {
            start: 0.1,
            end: 1.8,
            text: 'Synthetic statement',
            words: [
              { word: 'Synthetic', start: 0.1, end: 0.8 },
              { word: 'zero', start: 1, end: 1 },
              { word: 'overflow', start: 1.2, end: 2.4 },
              { word: 'before', start: 0.05, end: 0.09 },
              { word: 'after', start: 1.7, end: 1.9 },
              { word: ' ', start: 1.3, end: 1.5 },
              { word: null as unknown as string, start: 1.3, end: 1.5 },
            ],
          },
        ],
        2,
      ),
    ).toEqual([
      {
        start: 0.1,
        end: 1.8,
        text: 'Synthetic statement',
        words: [{ word: 'Synthetic', start: 0.1, end: 0.8 }],
      },
    ]);
  });

  it('preserves segments that do not include word timings', () => {
    const segments = [{ start: 0, end: 1, text: 'Synthetic statement' }];
    expect(normalizeCheckpointWords(segments, 1)).toEqual(segments);
  });
});

describe('transcribeJournalAlignedAudio', () => {
  it('uses an already aligned artifact without rewriting it', async () => {
    const transcribe = vi.fn(async (path: string) => path);
    const trimLeadingOverflow = vi.fn();

    await expect(
      transcribeJournalAlignedAudio(
        '/meeting/tail.wav',
        16.5,
        {
          probeDuration: async () => 16.6,
          createTemporaryPath: () => '/tmp/aligned.wav',
          trimLeadingOverflow,
          removeTemporaryFile: vi.fn(),
        },
        transcribe,
      ),
    ).resolves.toBe('/meeting/tail.wav');

    expect(trimLeadingOverflow).not.toHaveBeenCalled();
    expect(transcribe).toHaveBeenCalledWith('/meeting/tail.wav');
  });

  it('transcribes only the trailing journal duration of an overlong artifact', async () => {
    const transcribe = vi.fn(async (path: string) => path);
    const removeTemporaryFile = vi.fn();
    const trimLeadingOverflow = vi.fn(async () => true);

    await expect(
      transcribeJournalAlignedAudio(
        '/meeting/tail.wav',
        16.5,
        {
          probeDuration: async () => 33,
          createTemporaryPath: () => '/tmp/aligned.wav',
          trimLeadingOverflow,
          removeTemporaryFile,
        },
        transcribe,
      ),
    ).resolves.toBe('/tmp/aligned.wav');

    expect(trimLeadingOverflow).toHaveBeenCalledWith({
      inputPath: '/meeting/tail.wav',
      outputPath: '/tmp/aligned.wav',
      startSec: 16.5,
      durationSec: 16.5,
    });
    expect(transcribe).toHaveBeenCalledWith('/tmp/aligned.wav');
    expect(removeTemporaryFile).toHaveBeenCalledWith('/tmp/aligned.wav');
  });

  it('removes the temporary artifact when transcription fails', async () => {
    const removeTemporaryFile = vi.fn();

    await expect(
      transcribeJournalAlignedAudio(
        '/meeting/tail.wav',
        10,
        {
          probeDuration: async () => 20,
          createTemporaryPath: () => '/tmp/aligned.wav',
          trimLeadingOverflow: async () => true,
          removeTemporaryFile,
        },
        async () => {
          throw new Error('synthetic transcription failure');
        },
      ),
    ).rejects.toThrow('synthetic transcription failure');

    expect(removeTemporaryFile).toHaveBeenCalledWith('/tmp/aligned.wav');
  });

  it('fails before transcription when the trailing crop cannot be created', async () => {
    const transcribe = vi.fn();

    await expect(
      transcribeJournalAlignedAudio(
        '/meeting/tail.wav',
        10,
        {
          probeDuration: async () => 20,
          createTemporaryPath: () => '/tmp/aligned.wav',
          trimLeadingOverflow: async () => false,
          removeTemporaryFile: vi.fn(),
        },
        transcribe,
      ),
    ).rejects.toThrow('journal_audio_trim_failed');

    expect(transcribe).not.toHaveBeenCalled();
  });

  it('fails closed when artifact duration cannot be established', async () => {
    const transcribe = vi.fn();

    await expect(
      transcribeJournalAlignedAudio(
        '/meeting/tail.wav',
        10,
        {
          probeDuration: async () => null,
          createTemporaryPath: () => '/tmp/aligned.wav',
          trimLeadingOverflow: vi.fn(),
          removeTemporaryFile: vi.fn(),
        },
        transcribe,
      ),
    ).rejects.toThrow('journal_audio_duration_unavailable');

    expect(transcribe).not.toHaveBeenCalled();
  });

  it('removes the temporary artifact when crop creation rejects', async () => {
    const removeTemporaryFile = vi.fn();

    await expect(
      transcribeJournalAlignedAudio(
        '/meeting/tail.wav',
        10,
        {
          probeDuration: async () => 20,
          createTemporaryPath: () => '/tmp/aligned.wav',
          trimLeadingOverflow: async () => {
            throw new Error('synthetic crop failure');
          },
          removeTemporaryFile,
        },
        vi.fn(),
      ),
    ).rejects.toThrow('synthetic crop failure');

    expect(removeTemporaryFile).toHaveBeenCalledWith('/tmp/aligned.wav');
  });
});
