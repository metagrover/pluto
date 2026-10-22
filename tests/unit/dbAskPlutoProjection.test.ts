import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-ask-projection-${process.pid}-${Math.random().toString(16).slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  getAskPlutoMeeting,
  getAskPlutoMeetingHeaders,
  getAskPlutoMeetings,
  getCanonicalPersonCommitments,
  identityStore,
  saveMeeting,
  searchMeetingNotesFts,
  upsertEntity,
} from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

it('keeps completed adopted legacy actions and rejected self aliases closed in recall', () => {
  const self = upsertEntity({
    id: 'projection-self',
    type: 'person',
    name: 'Alex',
  });
  identityStore.setSelfPersonId(self.id);
  upsertEntity({
    id: 'legacy-adopted',
    type: 'action_item',
    name: 'Prepare the old checklist',
    status: 'completed',
    dedupe_by_name: false,
    metadata: {
      commitment_state: 'confirmed',
      dreamingSources: [{ meetingIds: ['scoped'] }],
    },
  });
  upsertEntity({
    id: 'rejected-self-alias',
    type: 'action_item',
    name: 'Send an obsolete report',
    status: 'active',
    dedupe_by_name: false,
    metadata: {
      commitment_state: 'rejected',
      assignee_name: 'Me',
      source_meeting_id: 'scoped',
      source_evidence: 'I will send an obsolete report',
    },
  });
  expect(getCanonicalPersonCommitments(self.id)?.excluded).toEqual(
    expect.arrayContaining([
      {
        text: 'Prepare the old checklist',
        status: 'completed',
        sourceMeetingId: 'scoped',
        ownershipVerified: false,
      },
      {
        text: 'Send an obsolete report',
        status: 'rejected',
        sourceMeetingId: 'scoped',
        ownershipVerified: false,
      },
    ]),
  );
});

it('does not attribute rejected owner-like prose or other owners to self', () => {
  const self = upsertEntity({
    id: 'structured-self',
    type: 'person',
    name: 'Riley',
  });
  identityStore.setSelfPersonId(self.id);
  for (const [id, assignedTo, name] of [
    ['rejected-prose-only', null, 'I will send the unknown checklist'],
    ['rejected-other-owner', 'other-owner', 'I will send the other checklist'],
    ['rejected-canonical-self', self.id, 'Send the self checklist'],
  ] as const) {
    upsertEntity({
      id,
      type: 'action_item',
      name,
      status: 'active',
      assigned_to: assignedTo,
      dedupe_by_name: false,
      metadata: {
        commitment_state: 'rejected',
        source_meeting_id: 'structured-meeting',
        source_evidence: name,
      },
    });
  }
  const texts = getCanonicalPersonCommitments(self.id)!.excluded.map(
    (action) => action.text,
  );
  expect(texts).toContain('Send the self checklist');
  expect(getCanonicalPersonCommitments(self.id)!.excluded).toContainEqual(
    expect.objectContaining({
      text: 'I will send the unknown checklist',
      ownershipVerified: false,
    }),
  );
  expect(texts).not.toContain('I will send the other checklist');
});

describe('Ask Pluto synthesized meeting projection', () => {
  it('returns notes and status without loading recording or transcript columns', () => {
    saveMeeting({
      id: 'synthetic-meeting',
      title: 'Project Atlas planning',
      started_at: '2026-09-01T10:00:00.000Z',
      transcript_json: JSON.stringify({ text: 'RAW_TRANSCRIPT_SENTINEL' }),
      audio_path: '/private/RAW_AUDIO_SENTINEL.wav',
      analysis_json: JSON.stringify({ overview: 'SYNTHESIZED_NOTE_SENTINEL' }),
      user_notes: 'SYNTHESIZED_USER_NOTE_SENTINEL',
    });

    const records = getAskPlutoMeetings();
    const record = getAskPlutoMeeting('synthetic-meeting');
    const headers = getAskPlutoMeetingHeaders();
    const searchResults = searchMeetingNotesFts('SYNTHESIZED');

    expect(records).toHaveLength(1);
    expect(searchResults).toHaveLength(1);
    expect(record?.analysis_json).toContain('SYNTHESIZED_NOTE_SENTINEL');
    expect(record?.user_notes).toBe('SYNTHESIZED_USER_NOTE_SENTINEL');
    for (const value of [records, record, headers, searchResults]) {
      const serialized = JSON.stringify(value);
      expect(serialized).not.toContain('RAW_TRANSCRIPT_SENTINEL');
      expect(serialized).not.toContain('RAW_AUDIO_SENTINEL');
    }
    expect(headers[0]).not.toHaveProperty('analysis_json');
  });
});

it('applies meeting and date scopes before the FTS limit', () => {
  for (let index = 0; index < 45; index++)
    saveMeeting({
      id: `outside-${index}`,
      title: 'Morgan',
      started_at: '2026-09-01T00:00:00Z',
      enhanced_notes: 'Morgan Morgan Morgan Morgan report.',
    });
  saveMeeting({
    id: 'scoped',
    title: 'Review',
    started_at: '2026-10-04T12:00:00Z',
    enhanced_notes: `Morgan owns the acceptance report. ${'General context. '.repeat(100)}`,
  });
  expect(
    searchMeetingNotesFts('Morgan', { limit: 1 }).map((row) => row.id),
  ).not.toContain('scoped');
  expect(
    searchMeetingNotesFts('Morgan', { limit: 1, meetingIds: ['scoped'] }).map(
      (row) => row.id,
    ),
  ).toEqual(['scoped']);
  expect(
    searchMeetingNotesFts('Morgan', {
      limit: 1,
      from: '2026-10-04T00:00:00Z',
      to: '2026-10-05T00:00:00Z',
    }).map((row) => row.id),
  ).toEqual(['scoped']);
  expect(
    searchMeetingNotesFts('Morgan', {
      limit: 1,
      meetingIds: ['scoped'],
      to: '2026-10-04T12:00:00Z',
    }),
  ).toEqual([]);
});

it('retains rejected and old completed tasks as exclusions for notes recall', () => {
  const person = upsertEntity({
    id: 'person-morgan',
    type: 'person',
    name: 'Morgan',
  });
  upsertEntity({
    id: 'rejected-report',
    type: 'action_item',
    name: 'Send obsolete report',
    assigned_to: person.id,
    status: 'active',
    metadata: {
      source_meeting_id: 'scoped',
      commitment_state: 'rejected',
      full_description: 'Send obsolete report.',
    },
  });
  upsertEntity({
    id: 'completed-checklist',
    type: 'action_item',
    name: 'Archive checklist',
    assigned_to: person.id,
    status: 'completed',
    metadata: {
      source_meeting_id: 'scoped',
      owner_source: 'user',
      full_description: 'Archive checklist.',
    },
  });
  expect(getCanonicalPersonCommitments(person.id)?.excluded).toEqual(
    expect.arrayContaining([
      {
        text: 'Send obsolete report.',
        status: 'rejected',
        sourceMeetingId: 'scoped',
        ownershipVerified: false,
      },
      {
        text: 'Archive checklist.',
        status: 'completed',
        sourceMeetingId: 'scoped',
        ownershipVerified: true,
      },
    ]),
  );
});

it('separates personal closed history from suppression-only and other-owned records', () => {
  const self = upsertEntity({
    id: 'status-self',
    type: 'person',
    name: 'Riley',
    dedupe_by_name: false,
  });
  identityStore.setSelfPersonId(self.id);
  const other = upsertEntity({
    id: 'status-other',
    type: 'person',
    name: 'Jordan',
    dedupe_by_name: false,
  });
  for (const action of [
    {
      id: 'status-reviewed',
      name: 'Schedule a review with Maya',
      metadata: {
        commitment_state: 'confirmed',
        reviewed_at: '2026-10-01T12:00:00Z',
      },
    },
    {
      id: 'status-unresolved',
      name: 'Prepare an uncertain report',
      metadata: {},
    },
    {
      id: 'status-other-owned',
      name: 'Send Jordan report',
      assigned_to: other.id,
      metadata: { owner_source: 'user', commitment_state: 'confirmed' },
    },
  ])
    upsertEntity({
      ...action,
      type: 'action_item',
      status: 'completed',
      dedupe_by_name: false,
      metadata: { ...action.metadata, source_meeting_id: 'scoped' },
    });
  const closed = getCanonicalPersonCommitments(self.id)?.excluded || [];
  expect(closed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        text: 'Schedule a review with Maya',
        ownershipVerified: true,
      }),
      expect.objectContaining({
        text: 'Prepare an uncertain report',
        ownershipVerified: false,
      }),
    ]),
  );
  expect(closed.some((item) => item.text === 'Send Jordan report')).toBe(false);
});
