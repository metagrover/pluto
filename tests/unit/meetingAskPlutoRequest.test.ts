import { describe, expect, it } from 'vitest';
import {
  MEETING_ASK_PLUTO_LIMITS,
  parseMeetingAskPlutoRequest,
} from '../../src/utils/meetingAskPlutoRequest';

const validLiveRequest = () => ({
  requestId: 'ask-pluto-request-1',
  query: 'What did we decide?',
  scope: {
    type: 'live_meeting',
    meetingId: 'meeting-live-1',
    title: 'Launch review',
    participants: ['Avery'],
    notes: '',
    transcript: [
      {
        id: 'segment-1',
        speaker: 'Avery',
        text: 'We will launch Friday.',
        timestampMs: 4_000,
        confirmed: true,
      },
    ],
    interimText: '',
  },
  turns: [{ role: 'user', content: 'Why?' }],
});

describe('meeting Ask Pluto request validation', () => {
  it('accepts a bounded live meeting request', () => {
    expect(parseMeetingAskPlutoRequest(validLiveRequest())).toMatchObject({
      ok: true,
    });
  });

  it('rejects a malformed optional live meeting ID', () => {
    expect(
      parseMeetingAskPlutoRequest({
        ...validLiveRequest(),
        scope: { ...validLiveRequest().scope, meetingId: 'not valid!' },
      }).ok,
    ).toBe(false);
  });

  it.each([
    null,
    {},
    { ...validLiveRequest(), query: 42 },
    {
      ...validLiveRequest(),
      scope: { ...validLiveRequest().scope, transcript: [{ text: 'bad' }] },
    },
    { ...validLiveRequest(), turns: [{ role: 'user', content: 42 }] },
  ])('rejects malformed renderer input without throwing', (request) => {
    expect(() => parseMeetingAskPlutoRequest(request)).not.toThrow();
    expect(parseMeetingAskPlutoRequest(request).ok).toBe(false);
  });

  it('rejects payloads that exceed main-process limits', () => {
    expect(
      parseMeetingAskPlutoRequest({
        ...validLiveRequest(),
        query: 'x'.repeat(MEETING_ASK_PLUTO_LIMITS.queryChars + 1),
      }).ok,
    ).toBe(false);
    expect(
      parseMeetingAskPlutoRequest({
        ...validLiveRequest(),
        scope: {
          ...validLiveRequest().scope,
          transcript: Array.from(
            { length: MEETING_ASK_PLUTO_LIMITS.transcriptSegments + 1 },
            (_, index) => ({
              id: `segment-${index}`,
              speaker: 'Avery',
              text: 'bounded',
              timestampMs: index,
              confirmed: true,
            }),
          ),
        },
      }).ok,
    ).toBe(false);
  });
});
