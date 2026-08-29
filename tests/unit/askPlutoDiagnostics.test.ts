import { describe, expect, it } from 'vitest';

import { describeMeetingAskPlutoRequest } from '../../src/utils/askPlutoDiagnostics';

describe('Ask Pluto request diagnostics', () => {
  it('describes live request sizes without exposing meeting content', () => {
    const diagnostics = describeMeetingAskPlutoRequest({
      requestId: 'ask-pluto-123',
      query: 'What is happening with the launch?',
      scope: {
        type: 'live_meeting',
        title: 'Private launch review',
        participants: ['Avery', 'Sam'],
        notes: 'Sensitive pricing note',
        transcript: [
          {
            id: 'segment-1',
            speaker: 'Avery',
            text: 'Sensitive transcript text',
            timestampMs: 1_000,
            confirmed: true,
          },
        ],
        interimText: 'Sensitive interim text',
      },
      turns: [{ role: 'user', content: 'Sensitive previous question' }],
    });

    expect(diagnostics).toEqual({
      requestId: 'ask-pluto-123',
      scopeType: 'live_meeting',
      queryChars: 34,
      turnCount: 1,
      transcriptSegments: 1,
      transcriptChars: 25,
      notesChars: 22,
      interimChars: 22,
      participantCount: 2,
    });
    expect(JSON.stringify(diagnostics)).not.toContain('Sensitive');
    expect(JSON.stringify(diagnostics)).not.toContain('Private');
  });
});
