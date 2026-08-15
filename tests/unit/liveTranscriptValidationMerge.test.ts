import { describe, expect, it } from 'vitest';

import {
  createStableLiveSegmentId,
  mergeValidatedTranscriptChunk,
} from '../../src/utils/liveTranscriptValidationMerge';

const preview = [
  {
    id: 'preview-a',
    speaker: 'Me',
    startTime: 10.1,
    endTime: 11.4,
    text: 'Synthetic alpha',
  },
  {
    id: 'preview-b',
    speaker: 'Me',
    startTime: 11.6,
    endTime: 13.2,
    text: 'Synthetic beta',
  },
];

describe('live transcript validation merge', () => {
  it('preserves preview IDs for monotonic time-aligned corrections', () => {
    const merged = mergeValidatedTranscriptChunk({
      preview,
      validated: [
        {
          speaker: 'Me',
          startTime: 10.05,
          endTime: 11.45,
          text: 'Synthetic alpha corrected',
        },
        {
          speaker: 'Me',
          startTime: 11.55,
          endTime: 13.1,
          text: 'Synthetic beta corrected',
        },
      ],
      source: 'mic',
      sequence: 2,
      chunkStartSec: 10,
      chunkEndSec: 15,
    });
    expect(merged?.map(({ id, text }) => ({ id, text }))).toEqual([
      { id: 'preview-a', text: 'Synthetic alpha corrected' },
      { id: 'preview-b', text: 'Synthetic beta corrected' },
    ]);
  });

  it('rejects speaker changes, out-of-bounds times, and unaligned rewrites', () => {
    const base = {
      preview,
      source: 'mic' as const,
      sequence: 2,
      chunkStartSec: 10,
      chunkEndSec: 15,
    };
    expect(
      mergeValidatedTranscriptChunk({
        ...base,
        validated: [
          { speaker: 'Them', startTime: 10.1, endTime: 11, text: 'Synthetic' },
        ],
      }),
    ).toBeNull();
    expect(
      mergeValidatedTranscriptChunk({
        ...base,
        validated: [
          { speaker: 'Me', startTime: 9.5, endTime: 10.5, text: 'Synthetic' },
        ],
      }),
    ).toBeNull();
    expect(
      mergeValidatedTranscriptChunk({
        ...base,
        validated: [
          { speaker: 'Me', startTime: 14, endTime: 14.8, text: 'Synthetic' },
        ],
      }),
    ).toBeNull();
  });

  it('creates deterministic source-bound IDs', () => {
    expect(createStableLiveSegmentId('system', 4, 20.25, 21.5)).toBe(
      createStableLiveSegmentId('system', 4, 20.25, 21.5),
    );
    expect(createStableLiveSegmentId('system', 4, 20.25, 21.5)).not.toBe(
      createStableLiveSegmentId('mic', 4, 20.25, 21.5),
    );
  });
});
