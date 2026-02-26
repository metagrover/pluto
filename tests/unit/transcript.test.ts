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
});
