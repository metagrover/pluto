import { describe, expect, it } from 'vitest';

import { buildAnalysisTranscriptFromJson } from '../../src/utils/transcript';

describe('buildAnalysisTranscriptFromJson', () => {
  it('formats transcript arrays with speaker labels', () => {
    const transcriptJson = JSON.stringify([
      { speaker: 'Me', text: 'Shared the rollout status.' },
      { speaker: 'Them', text: 'Asked for timing confirmation.' },
    ]);

    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      'Me: Shared the rollout status.\nThem: Asked for timing confirmation.',
    );
  });

  it('supports transcript objects that store segments', () => {
    const transcriptJson = JSON.stringify({
      segments: [
        { speaker: 1, text: 'Need to close the open blocker.' },
        { text: 'Decision is to ship on Monday.' },
      ],
    });

    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      '1: Need to close the open blocker.\nDecision is to ship on Monday.',
    );
  });

  it('drops invalid rows and returns empty for malformed data', () => {
    const transcriptJson = JSON.stringify([
      { speaker: 'Me', text: '  ' },
      { speaker: null, text: 42 },
      { text: 'Valid fallback row.' },
    ]);

    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      'Valid fallback row.',
    );
    expect(buildAnalysisTranscriptFromJson('{invalid json')).toBe('');
    expect(buildAnalysisTranscriptFromJson()).toBe('');
  });

  it('builds analysis from a readable projection without rewriting evidence', () => {
    const sourceSegments = [
      {
        id: 'remote-turn',
        speaker: 'Them',
        startTime: 10,
        endTime: 14,
        text: 'Um the rollout is uh ready',
      },
      {
        id: 'letter-artifact',
        speaker: 'Me',
        startTime: 11,
        endTime: 11.1,
        text: 's',
      },
      {
        id: 'letter-artifact-with-filler',
        speaker: 'Me',
        startTime: 12,
        endTime: 12.1,
        text: 'm uh',
      },
      {
        id: 'duplicate',
        speaker: 'Them',
        startTime: 10,
        endTime: 14,
        text: 'Um the rollout is uh ready',
      },
      {
        id: 'acknowledgement',
        speaker: 'Me',
        startTime: 15,
        endTime: 15.4,
        text: 'Okay',
      },
    ];
    const transcriptJson = JSON.stringify({ segments: sourceSegments });

    expect(buildAnalysisTranscriptFromJson(transcriptJson)).toBe(
      'Them: the rollout is ready\nMe: Okay',
    );
    expect(sourceSegments.map((segment) => segment.text)).toEqual([
      'Um the rollout is uh ready',
      's',
      'm uh',
      'Um the rollout is uh ready',
      'Okay',
    ]);
  });
});
