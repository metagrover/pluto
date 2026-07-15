import { describe, expect, it } from 'vitest';

import {
  buildStoredTranscriptActivityEvidence,
  parseStoredTranscriptActivityEvidence,
} from '../../src/utils/transcriptActivityEvidence';

describe('buildStoredTranscriptActivityEvidence', () => {
  it('keeps only content-free finite speaker windows', () => {
    expect(
      buildStoredTranscriptActivityEvidence([
        { startTime: 0, endTime: 12, speaker: 'Me' },
        { startTime: 12, endTime: 20, speaker: 'Them' },
        { startTime: 20, endTime: 20, speaker: 'Me' },
        { startTime: 22, endTime: 18, speaker: 'Them' },
      ]),
    ).toEqual({
      schemaVersion: 1,
      source: 'capture_activity_v1',
      windows: [
        { startTime: 0, endTime: 12, speaker: 'Me' },
        { startTime: 12, endTime: 20, speaker: 'Them' },
      ],
    });
  });
});

describe('parseStoredTranscriptActivityEvidence', () => {
  it('round-trips versioned stored activity evidence and rejects invalid schemas', () => {
    const stored = {
      schemaVersion: 1,
      source: 'capture_activity_v1',
      windows: [{ startTime: 0, endTime: 12, speaker: 'Me' }],
    };

    expect(parseStoredTranscriptActivityEvidence(stored)).toEqual(stored);
    expect(
      parseStoredTranscriptActivityEvidence({
        schemaVersion: 2,
        source: 'capture_activity_v1',
        windows: [{ startTime: 0, endTime: 12, speaker: 'Me' }],
      }),
    ).toBeNull();
  });
});
