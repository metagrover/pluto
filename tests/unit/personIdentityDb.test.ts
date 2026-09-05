import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-person-identity-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));

import * as db from '../../electron/db';

afterAll(() => {
  fs.rmSync(fixture.directory, { recursive: true, force: true });
});

const saveMeeting = (id: string, day: number) =>
  db.saveMeeting({
    id,
    title: `Meeting ${id}`,
    started_at: `2026-08-${String(day).padStart(2, '0')}T12:00:00.000Z`,
  });

describe('canonical person identity', () => {
  it('renames the canonical person and resolves future detections of the old name', () => {
    const person = db.upsertEntity({
      id: 'rename-person',
      type: 'person',
      name: 'Avery Smyth',
    });

    expect(db.updatePersonName(person.id, 'Avery Smith')).toMatchObject({
      id: person.id,
      name: 'Avery Smith',
      normalized_name: 'avery smith',
    });

    const detectedAgain = db.upsertEntity({
      type: 'person',
      name: 'Avery Smyth',
    });
    expect(detectedAgain).toMatchObject({
      id: person.id,
      name: 'Avery Smith',
    });
    expect(db.getPersonNameAliases(person.id)).toEqual(['Avery Smyth']);
  });

  it('merges meetings, confirmed commitments, and identity evidence without duplicate rows', () => {
    const canonical = db.upsertEntity({
      id: 'merge-canonical',
      type: 'person',
      name: 'Avery Chen',
      dedupe_by_name: false,
    });
    const duplicate = db.upsertEntity({
      id: 'merge-duplicate',
      type: 'person',
      name: 'Avery C.',
      dedupe_by_name: false,
    });
    saveMeeting('merge-meeting-a', 10);
    saveMeeting('merge-meeting-b', 11);
    db.addMeetingEntity({
      meeting_id: 'merge-meeting-a',
      entity_id: canonical.id,
      mention_count: 2,
      context: 'Canonical context',
    });
    db.addMeetingEntity({
      meeting_id: 'merge-meeting-b',
      entity_id: duplicate.id,
      mention_count: 3,
      context: 'Duplicate context',
    });
    db.identityStore.setBinding('merge-meeting-b', {
      speaker: 'Speaker 2',
      personId: duplicate.id,
      individual: true,
      source: 'user',
      sourceRevision: 'source-v1',
      evidence: [],
    });
    const action = db.upsertEntity({
      id: 'merge-action',
      type: 'action_item',
      name: 'Send the launch notes',
      status: 'active',
      metadata: {
        commitment_state: 'confirmed',
        source_meeting_id: 'merge-meeting-b',
      },
    });
    db.correctActionOwner(action.id, duplicate.id);

    db.mergePerson(duplicate.id, canonical.id);

    expect(db.resolvePersonIdentityId(duplicate.id)).toBe(canonical.id);
    const visiblePersonIds = db
      .getEntitiesByType('person')
      .map((person) => person.id);
    expect(visiblePersonIds).toContain(canonical.id);
    expect(visiblePersonIds).not.toContain(duplicate.id);
    expect(db.getPeopleBriefingSummaries()).toContainEqual(
      expect.objectContaining({
        id: canonical.id,
        name: 'Avery Chen',
        meetingCount: 2,
        mentionCount: 5,
        openCommitmentCount: 1,
      }),
    );

    const detail = db.getPersonBriefing(duplicate.id);
    expect(detail?.person.id).toBe(canonical.id);
    expect(detail?.meetings.map((meeting) => meeting.id)).toEqual([
      'merge-meeting-b',
      'merge-meeting-a',
    ]);
    expect(detail?.meetings[0]).toMatchObject({ evidence: 'confirmed' });
    expect(detail?.commitments.open.map((item) => item.id)).toEqual([
      action.id,
    ]);
    expect(detail?.mergedPeople).toEqual([
      expect.objectContaining({ id: duplicate.id, name: 'Avery C.' }),
    ]);
  });

  it('undoes a merge without moving or losing original evidence', () => {
    const canonical = db.upsertEntity({
      id: 'restore-canonical',
      type: 'person',
      name: 'Jordan Lee',
      dedupe_by_name: false,
    });
    const duplicate = db.upsertEntity({
      id: 'restore-duplicate',
      type: 'person',
      name: 'Jordy Lee',
      dedupe_by_name: false,
    });
    saveMeeting('restore-meeting-a', 12);
    saveMeeting('restore-meeting-b', 13);
    db.addMeetingEntity({
      meeting_id: 'restore-meeting-a',
      entity_id: canonical.id,
    });
    db.addMeetingEntity({
      meeting_id: 'restore-meeting-b',
      entity_id: duplicate.id,
    });

    db.mergePerson(duplicate.id, canonical.id);
    db.restorePersonMerge(duplicate.id);

    expect(db.resolvePersonIdentityId(duplicate.id)).toBe(duplicate.id);
    expect(db.getEntitiesByType('person').map((person) => person.id)).toEqual(
      expect.arrayContaining([canonical.id, duplicate.id]),
    );
    expect(
      db.getPersonBriefing(canonical.id)?.meetings.map(({ id }) => id),
    ).toEqual(['restore-meeting-a']);
    expect(
      db.getPersonBriefing(duplicate.id)?.meetings.map(({ id }) => id),
    ).toEqual(['restore-meeting-b']);
  });

  it('flags exact-name records for review without silently merging them', () => {
    const first = db.upsertEntity({
      id: 'possible-first',
      type: 'person',
      name: 'Sam Lee',
      dedupe_by_name: false,
    });
    const second = db.upsertEntity({
      id: 'possible-second',
      type: 'person',
      name: 'Sam Lee',
      dedupe_by_name: false,
    });

    const rows = db.getPeopleBriefingSummaries();
    expect(rows.find(({ id }) => id === first.id)?.possibleDuplicateCount).toBe(
      1,
    );
    expect(
      rows.find(({ id }) => id === second.id)?.possibleDuplicateCount,
    ).toBe(1);
    expect(db.resolvePersonIdentityId(first.id)).toBe(first.id);
    expect(db.resolvePersonIdentityId(second.id)).toBe(second.id);
  });

  it('restores nested aliases to the family they belonged to before a merge', () => {
    const destination = db.upsertEntity({
      id: 'nested-destination',
      type: 'person',
      name: 'Alex Morgan',
      dedupe_by_name: false,
    });
    const source = db.upsertEntity({
      id: 'nested-source',
      type: 'person',
      name: 'A. Morgan',
      dedupe_by_name: false,
    });
    const child = db.upsertEntity({
      id: 'nested-child',
      type: 'person',
      name: 'Alex M.',
      dedupe_by_name: false,
    });

    db.mergePerson(child.id, source.id);
    db.mergePerson(source.id, destination.id);
    expect(db.resolvePersonIdentityId(child.id)).toBe(destination.id);

    db.restorePersonMerge(source.id);
    expect(db.resolvePersonIdentityId(source.id)).toBe(source.id);
    expect(db.resolvePersonIdentityId(child.id)).toBe(source.id);
  });

  it('uses the canonical identity for meeting-scoped secondary processing', () => {
    const canonical = db.upsertEntity({
      id: 'processing-canonical',
      type: 'person',
      name: 'Taylor Reed',
      dedupe_by_name: false,
    });
    const duplicate = db.upsertEntity({
      id: 'processing-duplicate',
      type: 'person',
      name: 'T. Reed',
      dedupe_by_name: false,
    });
    saveMeeting('processing-meeting-a', 20);
    saveMeeting('processing-meeting-b', 21);
    db.addMeetingEntity({
      meeting_id: 'processing-meeting-a',
      entity_id: canonical.id,
      mention_count: 2,
    });
    db.addMeetingEntity({
      meeting_id: 'processing-meeting-b',
      entity_id: duplicate.id,
      mention_count: 3,
    });

    db.mergePerson(duplicate.id, canonical.id);

    expect(db.getPersonEntityIdsForMeeting('processing-meeting-b')).toEqual([
      canonical.id,
    ]);
    expect(
      db.getKnowledgeDocPersonCandidates({
        activeDays: 60,
        minMeetings: 1,
        minMentions: 1,
      }),
    ).toContainEqual(
      expect.objectContaining({
        person_id: canonical.id,
        person_name: 'Taylor Reed',
        meeting_count: 2,
        mention_count: 5,
      }),
    );
  });

  it('derives confirmed People evidence from a binding and removes it when cleared', () => {
    const person = db.upsertEntity({
      id: 'binding-only-person',
      type: 'person',
      name: 'Morgan Hale',
      dedupe_by_name: false,
    });
    saveMeeting('binding-only-meeting', 22);
    db.identityStore.setBinding('binding-only-meeting', {
      speaker: 'Remote Speaker 1',
      personId: person.id,
      individual: true,
      source: 'user',
      sourceRevision: 'source-v1',
      evidence: [],
    });

    expect(db.getPersonEntityIdsForMeeting('binding-only-meeting')).toEqual([
      person.id,
    ]);
    expect(db.getPeopleBriefingSummaries()).toContainEqual(
      expect.objectContaining({
        id: person.id,
        meetingCount: 1,
        mentionCount: 0,
        latestMeetingId: 'binding-only-meeting',
      }),
    );
    expect(db.getPersonBriefing(person.id)?.meetings).toEqual([
      expect.objectContaining({
        id: 'binding-only-meeting',
        evidence: 'confirmed',
      }),
    ]);

    db.identityStore.clearBinding('binding-only-meeting', 'Remote Speaker 1');

    expect(db.getPersonEntityIdsForMeeting('binding-only-meeting')).toEqual([]);
    expect(
      db.getPeopleBriefingSummaries().find(({ id }) => id === person.id)
        ?.meetingCount,
    ).toBe(0);
    expect(db.getPersonBriefing(person.id)?.meetings).toEqual([]);
  });
});
