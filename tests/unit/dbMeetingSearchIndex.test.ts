import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-meeting-search-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  deleteMeeting,
  getMeetingContextSectionIntegrity,
  getMeetingFtsIntegrity,
  getMeetingNotesFtsIntegrity,
  getTemporalMeetings,
  identityStore,
  listMeetingIdsForPersonIdentity,
  refreshMeetingIdentityProjection,
  repairMeetingFtsIndex,
  saveMeeting,
  searchMeetingContextSectionsFts,
  searchMeetingNotesFts,
  searchMeetingsFts,
  updatePersonName,
  upsertEntity,
} from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('meeting search index integrity', () => {
  it('keeps exactly one FTS document across repeated meeting refreshes', () => {
    for (let index = 0; index < 10; index += 1) {
      saveMeeting({
        id: 'today-1',
        title: 'Pricing review',
        started_at: '2026-08-25T17:00:00.000Z',
        transcript_json: JSON.stringify({
          segments: [{ text: `Pricing decision revision ${index}` }],
        }),
      });
    }

    expect(getMeetingFtsIntegrity()).toEqual({
      rowCount: 1,
      distinctMeetingCount: 1,
      duplicateRowCount: 0,
    });
    expect(searchMeetingsFts('"Pricing"')).toHaveLength(1);
  });

  it('repairs legacy duplicate documents from canonical meetings', () => {
    saveMeeting({ id: 'today-2', title: 'Launch review' });
    repairMeetingFtsIndex({ force: true });

    expect(getMeetingFtsIntegrity()).toEqual({
      rowCount: 2,
      distinctMeetingCount: 2,
      duplicateRowCount: 0,
    });
  });

  it('indexes effective meeting notes without transcript-only terms', () => {
    saveMeeting({
      id: 'notes-only-1',
      title: 'Launch review',
      transcript_json: JSON.stringify({
        segments: [{ text: 'Cobalt transcript-only phrase.' }],
      }),
      analysis_json: JSON.stringify({
        analysis_schema_version: 3,
        overview: 'The Orchid launch is planned for Thursday.',
        topics: [],
        all_decisions: [],
        all_action_items: [],
        meeting_type: 'team_sync',
        quality: {
          format_pass: true,
          retry_count: 0,
          fallback_used: false,
          issues: [],
        },
      }),
    });

    expect(searchMeetingNotesFts('"Orchid"')).toHaveLength(1);
    expect(searchMeetingNotesFts('"Cobalt"')).toHaveLength(0);
  });

  it('indexes accepted note headings and section summaries independently', () => {
    saveMeeting({
      id: 'section-index-1',
      title: 'Release review',
      analysis_json: JSON.stringify({
        analysis_schema_version: 3,
        overview: 'The team reviewed the release.',
        topics: [
          {
            title: 'Rollout sequence',
            summary: 'Canary customers receive the Juniper build first.',
            key_points: ['Monitor errors for one hour.'],
            decisions: [],
            action_items: [],
            open_questions: [],
          },
        ],
        all_decisions: [],
        all_action_items: [],
        meeting_type: 'team_sync',
        quality: {
          format_pass: true,
          retry_count: 0,
          fallback_used: false,
          issues: [],
        },
      }),
    });

    const matches = searchMeetingContextSectionsFts('"Juniper"');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      meeting: { id: 'section-index-1' },
      section: {
        heading: 'Rollout sequence',
        kind: 'discussion',
        trust_status: 'grounded',
      },
    });
    expect(getMeetingContextSectionIntegrity()).toEqual(
      expect.objectContaining({ duplicateRowCount: 0 }),
    );
    const sectionCount = getMeetingContextSectionIntegrity().rowCount;
    saveMeeting(matches[0].meeting);
    expect(getMeetingContextSectionIntegrity()).toMatchObject({
      rowCount: sectionCount,
      duplicateRowCount: 0,
      staleMeetingCount: 0,
    });
  });

  it('refreshes projected self identity without regenerating saved notes', () => {
    const person = upsertEntity({
      type: 'person',
      name: 'Alex Search Identity',
      dedupe_by_name: false,
    });
    identityStore.setSelfPersonId(person.id);
    saveMeeting({
      id: 'identity-projection-search',
      title: 'Identity review',
      transcript_json: JSON.stringify({
        segments: [{ speaker: 'Me', text: 'I am preparing the project.' }],
      }),
      analysis_json: JSON.stringify({
        analysis_schema_version: 3,
        overview: "Me's project is ready.",
        topics: [],
        all_decisions: [],
        all_action_items: [],
        meeting_type: 'one_on_one',
        quality: {
          format_pass: true,
          retry_count: 0,
          fallback_used: false,
          issues: [],
        },
      }),
    });
    identityStore.recordCapture(
      'identity-projection-search',
      'local',
      person.id,
    );

    expect(refreshMeetingIdentityProjection('identity-projection-search')).toBe(
      true,
    );
    expect(searchMeetingNotesFts('"Alex"')).toHaveLength(1);
    expect(searchMeetingNotesFts('"Me"')).toHaveLength(0);

    updatePersonName(person.id, 'Casey Search Identity');
    expect(listMeetingIdsForPersonIdentity([person.id])).toContain(
      'identity-projection-search',
    );
    refreshMeetingIdentityProjection('identity-projection-search');
    expect(searchMeetingNotesFts('"Casey"')).toHaveLength(1);
    expect(searchMeetingNotesFts('"Alex"')).toHaveLength(0);
  });

  it('refreshes the notes index from user edit overlays', () => {
    const analysisJson = JSON.stringify({
      analysis_schema_version: 3,
      overview: 'The Orchid launch is planned for Thursday.',
      topics: [],
      all_decisions: [],
      all_action_items: [],
      meeting_type: 'team_sync',
      quality: {
        format_pass: true,
        retry_count: 0,
        fallback_used: false,
        issues: [],
      },
    });
    saveMeeting({
      id: 'notes-only-1',
      title: 'Launch review',
      analysis_json: analysisJson,
      user_edits_json: JSON.stringify({
        overview: {
          original: 'The Orchid launch is planned for Thursday.',
          edited: 'The Marigold launch is planned for Friday.',
          edited_at: '2026-08-31T00:00:00.000Z',
        },
      }),
    });

    expect(searchMeetingNotesFts('"Orchid"')).toHaveLength(0);
    expect(searchMeetingNotesFts('"Marigold"')).toHaveLength(1);
    expect(searchMeetingContextSectionsFts('"Orchid"')).toHaveLength(0);
    expect(searchMeetingContextSectionsFts('"Marigold"')).toHaveLength(1);
    expect(getMeetingNotesFtsIntegrity()).toEqual(
      expect.objectContaining({ duplicateRowCount: 0 }),
    );
  });

  it('removes derived notes search evidence when its meeting is deleted', () => {
    saveMeeting({
      id: 'notes-delete-1',
      title: 'Deletion review',
      enhanced_notes: 'Marzipan deletion marker.',
    });
    expect(searchMeetingNotesFts('"Marzipan"')).toHaveLength(1);
    const beforeDelete = getMeetingNotesFtsIntegrity().rowCount;

    deleteMeeting('notes-delete-1');

    expect(searchMeetingNotesFts('"Marzipan"')).toHaveLength(0);
    expect(getMeetingNotesFtsIntegrity().rowCount).toBe(beforeDelete - 1);
  });

  it('removes derived section evidence when its meeting is deleted', () => {
    saveMeeting({
      id: 'section-delete-1',
      title: 'Section deletion review',
      enhanced_notes: '## Cleanup\nSaffron section deletion marker.',
    });
    expect(searchMeetingContextSectionsFts('"Saffron"')).toHaveLength(1);
    const beforeDelete = getMeetingContextSectionIntegrity().rowCount;

    deleteMeeting('section-delete-1');

    expect(searchMeetingContextSectionsFts('"Saffron"')).toHaveLength(0);
    expect(getMeetingContextSectionIntegrity().rowCount).toBe(beforeDelete - 1);
  });

  it('uses a half-open temporal range and returns complete meeting rows', () => {
    saveMeeting({
      id: 'tomorrow-boundary',
      title: 'Tomorrow',
      started_at: '2026-08-26T07:00:00.000Z',
    });

    const meetings = getTemporalMeetings({
      from: '2026-08-25T07:00:00.000Z',
      to: '2026-08-26T07:00:00.000Z',
    });

    expect(meetings.map((meeting) => meeting.id)).toContain('today-1');
    expect(meetings.map((meeting) => meeting.id)).not.toContain(
      'tomorrow-boundary',
    );
    expect(meetings.find((meeting) => meeting.id === 'today-1')?.title).toBe(
      'Pricing review',
    );
  });
});
