import { describe, expect, it } from 'vitest';

import type { CalendarEvent } from '../../electron/calendar/types';
import {
  extractConferenceUrl,
  hasConferenceLink,
} from '../../src/utils/conferenceUrl';

describe('conference URL extraction and detection', () => {
  it('detects and extracts Zoom meeting URLs', () => {
    const zoomUrl1 = 'https://us02web.zoom.us/j/1234567890?pwd=abc';
    const zoomUrl2 = 'https://company.zoom.us/my/johndoe';
    const zoomUrl3 = 'https://zoom.us/wc/join/123456789';

    expect(extractConferenceUrl(zoomUrl1)).toBe(zoomUrl1);
    expect(extractConferenceUrl(`Join meeting at ${zoomUrl2} please`)).toBe(
      zoomUrl2,
    );
    expect(extractConferenceUrl(zoomUrl3)).toBe(zoomUrl3);
  });

  it('detects and extracts Google Meet URLs', () => {
    const meetUrl = 'https://meet.google.com/abc-defg-hij';
    expect(extractConferenceUrl(meetUrl)).toBe(meetUrl);
    expect(extractConferenceUrl(`Meeting link: ${meetUrl}?authuser=0`)).toBe(
      'https://meet.google.com/abc-defg-hij?authuser=0',
    );
  });

  it('detects and extracts Microsoft Teams meeting URLs', () => {
    const teamsUrl =
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d';
    const teamsLiveUrl = 'https://teams.live.com/meet/9876543210';

    expect(extractConferenceUrl(teamsUrl)).toBe(teamsUrl);
    expect(extractConferenceUrl(teamsLiveUrl)).toBe(teamsLiveUrl);
  });

  it('detects and extracts Webex meeting URLs', () => {
    const webexUrl = 'https://company.webex.com/meet/alice';
    expect(extractConferenceUrl(webexUrl)).toBe(webexUrl);
  });

  it('detects and extracts Slack huddle/call URLs', () => {
    const slackUrl = 'https://app.slack.com/huddle/T123/C456';
    expect(extractConferenceUrl(slackUrl)).toBe(slackUrl);
  });

  it('returns null for text with no conference links', () => {
    expect(extractConferenceUrl(null)).toBeNull();
    expect(extractConferenceUrl(undefined)).toBeNull();
    expect(extractConferenceUrl('')).toBeNull();
    expect(extractConferenceUrl('Just a 1:1 sync in Room 402')).toBeNull();
    expect(
      extractConferenceUrl('https://github.com/metagrover/pluto'),
    ).toBeNull();
  });

  it('checks CalendarEvent across title, location, notes, and url fields', () => {
    const baseEvent: CalendarEvent = {
      occurrenceKey: 'event-1',
      eventIdentifier: 'event-1',
      calendarIdentifier: 'cal-1',
      title: 'Weekly Standup',
      start: '2026-09-04T17:00:00.000Z',
      end: '2026-09-04T17:30:00.000Z',
      isAllDay: false,
      isCancelled: false,
      availability: 'busy',
      organizer: null,
      attendees: [],
      lastModified: null,
    };

    expect(hasConferenceLink(baseEvent)).toBe(false);

    // Link in title
    expect(
      hasConferenceLink({
        ...baseEvent,
        title: 'Standup (https://meet.google.com/xyz-uvwx-rst)',
      }),
    ).toBe(true);

    // Link in location
    expect(
      hasConferenceLink({
        ...baseEvent,
        location: 'https://zoom.us/j/9988776655',
      } as any),
    ).toBe(true);

    // Link in notes
    expect(
      hasConferenceLink({
        ...baseEvent,
        notes:
          'Agenda:\n1. Updates\n2. Zoom: https://us06web.zoom.us/j/11223344',
      } as any),
    ).toBe(true);

    // Link in url
    expect(
      hasConferenceLink({
        ...baseEvent,
        url: 'https://teams.microsoft.com/l/meetup-join/123',
      } as any),
    ).toBe(true);
  });
});
