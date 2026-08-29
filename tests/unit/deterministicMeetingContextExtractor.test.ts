import { describe, expect, it } from 'vitest';

import { extractDeterministicMeetingContextEvents } from '../../electron/intelligence/deterministicMeetingContextExtractor';
import type { MeetingContextIngestionSegment } from '../../src/types/meetingContext';

const segment = (
  overrides: Partial<MeetingContextIngestionSegment> = {},
): MeetingContextIngestionSegment => ({
  id: 'eou:1:mic:committed-4',
  speaker: 'Speaker',
  text: "Let's discuss the launch plan.",
  timestampMs: 42_000,
  confirmed: true,
  ...overrides,
});

describe('deterministic meeting context extraction', () => {
  it.each([
    ["Let's discuss the launch plan.", 'topic', 'the launch plan'],
    ['We decided to launch Monday.', 'decision', 'to launch Monday'],
    ["I'll send the checklist.", 'action', 'send the checklist'],
    ['What remains blocked?', 'open_question', 'What remains blocked?'],
    ['The constraint is a 4 PM cutoff.', 'fact', 'a 4 PM cutoff'],
  ] as const)('extracts %s as %s', (text, kind, summary) => {
    const events = extractDeterministicMeetingContextEvents(
      'meeting-1',
      segment({ text }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        meetingId: 'meeting-1',
        kind,
        summary,
        observedAtMs: 42_000,
        evidence: [
          {
            segmentId: 'eou:1:mic:committed-4',
            timestampMs: 42_000,
            quote: text,
          },
        ],
      }),
    );
  });

  it('ignores tentative rows, empty cue remainders, and speculative decisions', () => {
    expect(
      extractDeterministicMeetingContextEvents(
        'meeting-1',
        segment({ confirmed: false, text: 'We decided to launch.' }),
      ),
    ).toEqual([]);
    expect(
      extractDeterministicMeetingContextEvents(
        'meeting-1',
        segment({ text: 'We decided.' }),
      ),
    ).toEqual([]);
    expect(
      extractDeterministicMeetingContextEvents(
        'meeting-1',
        segment({ text: 'I think we should launch Monday.' }),
      ),
    ).toEqual([]);
  });

  it('uses stable keys and never promotes generic speakers to owners', () => {
    const first = extractDeterministicMeetingContextEvents(
      'meeting-1',
      segment({ text: "I'll send the checklist." }),
    );
    const replay = extractDeterministicMeetingContextEvents(
      'meeting-1',
      segment({ text: "  I'll   send the checklist.  " }),
    );

    expect(replay[0].eventKey).toBe(first[0].eventKey);
    expect(first[0].attributes?.owner).toBeNull();
  });

  it('copies a non-generic first-person speaker as the action owner', () => {
    const [event] = extractDeterministicMeetingContextEvents(
      'meeting-1',
      segment({ speaker: 'Riley', text: 'I will send the checklist.' }),
    );

    expect(event.attributes?.owner).toBe('Riley');
  });
});
