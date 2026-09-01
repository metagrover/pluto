import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-person-briefing-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import * as db from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

beforeEach(() => {
  db.resetKnowledge();
  db.calendarStore.disconnect();
});

const saveFixtureMeeting = (id: string, startedAt: string) =>
  db.saveMeeting({
    id,
    title: `Meeting ${id}`,
    started_at: startedAt,
    duration_seconds: 1_800,
  });

describe('person briefing database read model', () => {
  it('builds every People list row in one bounded summary read', () => {
    const person = db.upsertEntity({
      id: 'person-summary',
      type: 'person',
      name: 'Avery Summary',
      metadata: { role: 'Design lead' },
    });
    saveFixtureMeeting('summary-meeting', '2026-08-01T12:00:00.000Z');
    db.addMeetingEntity({
      meeting_id: 'summary-meeting',
      entity_id: person.id,
      mention_count: 3,
      context: 'Reviewed the launch sequence.',
    });
    const action = db.upsertEntity({
      id: 'summary-action',
      type: 'action_item',
      name: 'Send the launch review',
      status: 'active',
      metadata: {
        commitment_state: 'confirmed',
        source_meeting_id: 'summary-meeting',
      },
    });
    db.correctActionOwner(action.id, person.id);

    expect(db.getPeopleBriefingSummaries()).toContainEqual({
      id: person.id,
      name: 'Avery Summary',
      role: 'Design lead',
      meetingCount: 1,
      mentionCount: 3,
      latestMeetingId: 'summary-meeting',
      latestMeetingTitle: 'Meeting summary-meeting',
      latestMeetingAt: '2026-08-01T12:00:00.000Z',
      context: 'Reviewed the launch sequence.',
      openCommitmentCount: 1,
      possibleDuplicateCount: 0,
    });
  });

  it('separates confirmed, scheduled, and mentioned-only meetings', () => {
    const person = db.upsertEntity({
      id: 'person-avery',
      type: 'person',
      name: 'Avery Chen',
      metadata: { role: 'Design lead' },
    });
    saveFixtureMeeting('confirmed', '2026-08-01T12:00:00.000Z');
    saveFixtureMeeting('scheduled', '2026-08-02T12:00:00.000Z');
    saveFixtureMeeting('mentioned', '2026-08-03T12:00:00.000Z');
    db.identityStore.setBinding('confirmed', {
      speaker: 'Speaker 2',
      personId: person.id,
      individual: true,
      source: 'user',
      sourceRevision: 'source-v1',
      evidence: [],
    });
    db.addMeetingEntity({
      meeting_id: 'mentioned',
      entity_id: person.id,
      context: 'Avery was referenced while reviewing the launch.',
    });
    db.calendarStore.selectCalendar({
      identifier: 'calendar-1',
      title: 'Work',
      sourceTitle: 'Local',
      sourceType: 'local',
      colorHex: null,
    });
    db.calendarStore.replaceEvents({
      calendarIdentifier: 'calendar-1',
      revision: 1,
      cacheStart: '2026-08-01T00:00:00.000Z',
      cacheEnd: '2026-08-04T00:00:00.000Z',
      readAt: '2026-08-01T00:00:00.000Z',
      events: [
        {
          occurrenceKey: 'scheduled-event',
          eventIdentifier: 'scheduled-event',
          calendarIdentifier: 'calendar-1',
          title: 'Planning review',
          start: '2026-08-02T12:00:00.000Z',
          end: '2026-08-02T12:30:00.000Z',
          isAllDay: false,
          isCancelled: false,
          availability: 'busy',
          organizer: null,
          attendees: [{ name: 'Avery Chen', email: null }],
          lastModified: null,
        },
      ],
    });
    db.calendarStore.setMeetingContext(
      'scheduled',
      'scheduled-event',
      'automatic',
    );

    const briefing = db.getPersonBriefing(person.id);

    expect(briefing?.meetings).toEqual([
      expect.objectContaining({ id: 'mentioned', evidence: 'mentioned' }),
      expect.objectContaining({ id: 'scheduled', evidence: 'scheduled' }),
      expect.objectContaining({ id: 'confirmed', evidence: 'confirmed' }),
    ]);
    expect(briefing?.person).toMatchObject({
      id: person.id,
      name: 'Avery Chen',
    });
  });

  it('does not attach a calendar attendee when the name is ambiguous', () => {
    const person = db.upsertEntity({
      id: 'person-sam-1',
      type: 'person',
      name: 'Sam Lee',
      dedupe_by_name: false,
    });
    db.upsertEntity({
      id: 'person-sam-2',
      type: 'person',
      name: 'Sam Lee',
      dedupe_by_name: false,
    });
    saveFixtureMeeting('ambiguous-calendar', '2026-08-04T12:00:00.000Z');
    db.calendarStore.selectCalendar({
      identifier: 'calendar-2',
      title: 'Work',
      sourceTitle: 'Local',
      sourceType: 'local',
      colorHex: null,
    });
    db.calendarStore.replaceEvents({
      calendarIdentifier: 'calendar-2',
      revision: 1,
      cacheStart: '2026-08-04T00:00:00.000Z',
      cacheEnd: '2026-08-05T00:00:00.000Z',
      readAt: '2026-08-04T00:00:00.000Z',
      events: [
        {
          occurrenceKey: 'ambiguous-event',
          eventIdentifier: 'ambiguous-event',
          calendarIdentifier: 'calendar-2',
          title: 'Review',
          start: '2026-08-04T12:00:00.000Z',
          end: '2026-08-04T12:30:00.000Z',
          isAllDay: false,
          isCancelled: false,
          availability: 'busy',
          organizer: null,
          attendees: [{ name: 'Sam Lee', email: null }],
          lastModified: null,
        },
      ],
    });
    db.calendarStore.setMeetingContext(
      'ambiguous-calendar',
      'ambiguous-event',
      'automatic',
    );

    expect(db.getPersonBriefing(person.id)?.meetings).toEqual([]);
  });

  it('returns only commitments assigned through the explicit owner boundary', () => {
    const person = db.upsertEntity({
      id: 'person-owner',
      type: 'person',
      name: 'Jordan Vale',
    });
    saveFixtureMeeting('source', '2026-08-20T12:00:00.000Z');
    const action = db.upsertEntity({
      id: 'verified-action',
      type: 'action_item',
      name: 'Deliver the launch plan',
      status: 'active',
      metadata: {
        commitment_state: 'confirmed',
        origin: 'extraction',
        source_meeting_id: 'source',
        source_evidence: 'Jordan will deliver the launch plan.',
      },
    });
    db.correctActionOwner(action.id, person.id);
    db.upsertEntity({
      id: 'name-only-action',
      type: 'action_item',
      name: 'Unverified follow-up',
      status: 'active',
      metadata: {
        commitment_state: 'confirmed',
        origin: 'extraction',
        source_meeting_id: 'source',
        assignee_name: 'Jordan Vale',
      },
    });

    const briefing = db.getPersonBriefing(person.id);

    expect(briefing?.commitments.open.map((item) => item.id)).toEqual([
      'verified-action',
    ]);
  });

  it('returns undefined for a missing or non-person entity', () => {
    const topic = db.upsertEntity({ type: 'topic', name: 'Trust' });
    expect(db.getPersonBriefing('missing')).toBeUndefined();
    expect(db.getPersonBriefing(topic.id)).toBeUndefined();
  });
});
