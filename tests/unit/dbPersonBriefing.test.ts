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
      roleSourceMeetingId: null,
      meetingCount: 1,
      mentionCount: 3,
      latestMeetingId: 'summary-meeting',
      latestMeetingTitle: 'Meeting summary-meeting',
      latestMeetingAt: '2026-08-01T12:00:00.000Z',
      context: 'Reviewed the launch sequence.',
      openCommitmentCount: 1,
      candidateCommitmentCount: 0,
      briefHeadline: null,
      briefStatus: null,
      briefUpdatedAt: null,
      possibleDuplicateCount: 0,
      isSelf: false,
    });
  });

  it('rejects placeholder person labels before persistence', () => {
    expect(() => db.upsertEntity({ type: 'person', name: 'None' })).toThrow(
      'person_name_invalid',
    );
    expect(() =>
      db.upsertEntity({ type: 'person', name: 'Them (again)' }),
    ).toThrow('person_name_invalid');
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

  it('separates verified commitments from owner candidates', () => {
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

    // For non-self individuals (isSelf === false), extracted commitments automatically show up in open commitments
    const peerBriefing = db.getPersonBriefing(person.id);
    expect(
      db
        .getPeopleBriefingSummaries()
        .find((summary) => summary.id === person.id),
    ).toMatchObject({
      openCommitmentCount: 2,
      candidateCommitmentCount: 0,
    });
    expect(peerBriefing?.commitments.open.map((item) => item.id)).toEqual([
      'verified-action',
      'name-only-action',
    ]);
    expect(peerBriefing?.commitments.candidates).toEqual([]);

    // For the active workspace user (isSelf === true), friction is preserved:
    // extracted commitments require confirmation before entering open commitments
    db.identityStore.setSelfPersonId(person.id);
    const selfBriefing = db.getPersonBriefing(person.id);

    expect(
      db
        .getPeopleBriefingSummaries()
        .find((summary) => summary.id === person.id),
    ).toBeUndefined();
    expect(selfBriefing?.commitments.open.map((item) => item.id)).toEqual([
      'verified-action',
    ]);
    expect(selfBriefing?.commitments.candidates).toEqual([
      expect.objectContaining({
        id: 'name-only-action',
        suggestedOwnerName: 'Jordan Vale',
      }),
    ]);

    db.correctActionOwner('name-only-action', person.id);
    expect(db.getPersonBriefing(person.id)?.commitments).toMatchObject({
      open: [
        expect.objectContaining({ id: 'verified-action' }),
        expect.objectContaining({ id: 'name-only-action' }),
      ],
      candidates: [],
    });

    db.correctActionOwner('name-only-action', null);
    expect(db.getPersonBriefing(person.id)?.commitments).toMatchObject({
      open: [expect.objectContaining({ id: 'verified-action' })],
      candidates: [],
    });
    db.identityStore.setSelfPersonId(null);
  });

  it('surfaces candidate commitments from meetings where the speaker was bound to the person', () => {
    const person = db.upsertEntity({ type: 'person', name: 'Ayush Grover' });
    db.saveMeeting({
      id: 'meeting-bound-speaker',
      title: 'Roadmap Planning',
      created_at: '2026-08-30T10:00:00.000Z',
    });
    db.upsertEntity({
      id: 'action-speaker-1',
      type: 'action_item',
      name: 'Finalize quarterly roadmap',
      status: 'active',
      metadata: {
        commitment_state: 'possible',
        origin: 'extraction',
        source_meeting_id: 'meeting-bound-speaker',
        assignee_name: 'Speaker 1',
      },
    });

    // Before binding: not recognized as Ayush's candidate
    expect(
      db
        .getPeopleBriefingSummaries()
        .find((summary) => summary.id === person.id)
        ?.candidateCommitmentCount ?? 0,
    ).toBe(0);
    expect(db.getPersonBriefing(person.id)?.commitments.candidates).toEqual([]);

    // Bind Speaker 1 to Ayush for this meeting
    db.identityStore.setBinding('meeting-bound-speaker', {
      speaker: 'Speaker 1',
      personId: person.id,
      individual: true,
      source: 'user',
      sourceRevision: 'rev-1',
      evidence: [],
    });

    // For non-self peer: binding Speaker 1 automatically promotes the commitment to open
    expect(
      db
        .getPeopleBriefingSummaries()
        .find((summary) => summary.id === person.id),
    ).toMatchObject({
      openCommitmentCount: 1,
      candidateCommitmentCount: 0,
    });

    const peerBriefing = db.getPersonBriefing(person.id);
    expect(peerBriefing?.commitments.open).toEqual([
      expect.objectContaining({
        id: 'action-speaker-1',
        sourceMeetingTitle: 'Roadmap Planning',
      }),
    ]);
    expect(peerBriefing?.commitments.candidates).toEqual([]);

    // For the active user (isSelf === true): candidate commitments require confirmation
    db.identityStore.setSelfPersonId(person.id);
    expect(
      db
        .getPeopleBriefingSummaries()
        .find((summary) => summary.id === person.id),
    ).toBeUndefined();

    const selfBriefing = db.getPersonBriefing(person.id);
    expect(selfBriefing?.commitments.candidates).toEqual([
      expect.objectContaining({
        id: 'action-speaker-1',
        suggestedOwnerName: 'Ayush Grover',
        sourceMeetingTitle: 'Roadmap Planning',
      }),
    ]);

    // Clearing binding removes candidate
    db.identityStore.clearBinding('meeting-bound-speaker', 'Speaker 1');
    expect(
      db
        .getPeopleBriefingSummaries()
        .find((summary) => summary.id === person.id)
        ?.candidateCommitmentCount ?? 0,
    ).toBe(0);
    expect(db.getPersonBriefing(person.id)?.commitments.candidates).toEqual([]);

    // Re-bind and confirm candidate
    db.identityStore.setBinding('meeting-bound-speaker', {
      speaker: 'Speaker 1',
      personId: person.id,
      individual: true,
      source: 'user',
      sourceRevision: 'rev-2',
      evidence: [],
    });
    db.correctActionOwner('action-speaker-1', person.id);
    expect(db.getPersonBriefing(person.id)?.commitments).toMatchObject({
      open: [expect.objectContaining({ id: 'action-speaker-1' })],
      candidates: [],
    });
    db.identityStore.setSelfPersonId(null);
  });

  it('returns undefined for a missing or non-person entity', () => {
    const topic = db.upsertEntity({ type: 'topic', name: 'Trust' });
    expect(db.getPersonBriefing('missing')).toBeUndefined();
    expect(db.getPersonBriefing(topic.id)).toBeUndefined();
  });
});
