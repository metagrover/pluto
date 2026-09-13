import type Database from 'better-sqlite3';
import type { PersistedMeeting } from '../db';
import type { MidFrontmatter } from '../intelligence/intelligenceTypes';
import { buildMeetingNotesEvidenceDocument } from '../intelligence/meetingNotesEvidence';

export interface SearchIndexIntegrity {
  rowCount: number;
  distinctMeetingCount: number;
  duplicateRowCount: number;
}

const readIntegrity = (
  sqlite: Database.Database,
  table: 'meetings_fts' | 'meeting_notes_fts',
): SearchIndexIntegrity => {
  const result = sqlite
    .prepare(
      `SELECT COUNT(*) AS row_count,
              COUNT(DISTINCT meeting_id) AS distinct_meeting_count
       FROM ${table}`,
    )
    .get() as { row_count: number; distinct_meeting_count: number };
  return {
    rowCount: result.row_count,
    distinctMeetingCount: result.distinct_meeting_count,
    duplicateRowCount: result.row_count - result.distinct_meeting_count,
  };
};

export const refreshMeetingNotesFts = (
  sqlite: Database.Database,
  meeting: PersistedMeeting,
  speakerDisplayNames: Readonly<Record<string, string>> = {},
): void => {
  const document = buildMeetingNotesEvidenceDocument(
    meeting,
    speakerDisplayNames,
  );
  sqlite
    .prepare('DELETE FROM meeting_notes_fts WHERE meeting_id = ?')
    .run(document.meetingId);
  sqlite
    .prepare(
      `INSERT INTO meeting_notes_fts (
        title, notes_text, decisions_text, action_items_text,
        topics_text, participants_text, meeting_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      document.title,
      document.notesText,
      document.decisionsText,
      document.actionItemsText,
      document.topicsText,
      document.participantsText,
      document.meetingId,
    );
};

export const refreshMeetingFts = (
  sqlite: Database.Database,
  meeting: PersistedMeeting,
  speakerDisplayNames: Readonly<Record<string, string>> = {},
): void => {
  const id = String(meeting.id);
  let transcriptText = '';
  try {
    const transcript = meeting.transcript_json
      ? JSON.parse(meeting.transcript_json)
      : null;
    const segments = Array.isArray(transcript)
      ? transcript
      : Array.isArray(transcript?.segments)
        ? transcript.segments
        : [];
    transcriptText = segments
      .map((segment: { text?: string }) =>
        typeof segment?.text === 'string' ? segment.text.trim() : '',
      )
      .filter(Boolean)
      .join(' ');
  } catch {
    // A malformed transcript must not prevent other meeting fields being indexed.
  }

  let participants = '';
  let topics = '';
  let decisions = '';
  let actionItems = '';
  if (meeting.mid_json?.trim()) {
    try {
      const mid = JSON.parse(meeting.mid_json) as MidFrontmatter;
      participants = (mid.participants || [])
        .map((item) => item.name)
        .join(', ');
      topics = (mid.topics || []).map((item) => item.name).join(', ');
      decisions = (mid.decisions || [])
        .map((item) => item.description)
        .join(', ');
      actionItems = (mid.action_items || [])
        .map((item) => item.description)
        .join(', ');
    } catch {
      // MID is optional derived data and may be repaired separately.
    }
  }

  const projectedNotes = buildMeetingNotesEvidenceDocument(
    meeting,
    speakerDisplayNames,
  ).notesText;

  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM meetings_fts WHERE meeting_id = ?').run(id);
    sqlite
      .prepare(
        `INSERT INTO meetings_fts (
          title, transcript_text, enhanced_notes, user_notes,
          mid_participants, mid_topics, mid_decisions, mid_action_items, meeting_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        meeting.title,
        transcriptText,
        projectedNotes || meeting.enhanced_notes || '',
        meeting.user_notes || '',
        participants,
        topics,
        decisions,
        actionItems,
        id,
      );
    refreshMeetingNotesFts(sqlite, meeting, speakerDisplayNames);
  })();
};

export const getMeetingFtsIntegrity = (
  sqlite: Database.Database,
): SearchIndexIntegrity => readIntegrity(sqlite, 'meetings_fts');

export const getMeetingNotesFtsIntegrity = (
  sqlite: Database.Database,
): SearchIndexIntegrity => readIntegrity(sqlite, 'meeting_notes_fts');

const repairIndex = (
  sqlite: Database.Database,
  table: 'meetings_fts' | 'meeting_notes_fts',
  refresh: (sqlite: Database.Database, meeting: PersistedMeeting) => void,
  force = false,
): { rebuilt: boolean; indexedMeetingCount: number } => {
  const integrity = readIntegrity(sqlite, table);
  const meetingCount = (
    sqlite.prepare('SELECT COUNT(*) AS count FROM meetings').get() as {
      count: number;
    }
  ).count;
  if (
    !force &&
    integrity.duplicateRowCount === 0 &&
    integrity.distinctMeetingCount === meetingCount
  ) {
    return { rebuilt: false, indexedMeetingCount: meetingCount };
  }

  const meetings = sqlite
    .prepare('SELECT * FROM meetings')
    .all() as PersistedMeeting[];
  sqlite.transaction(() => {
    sqlite.prepare(`DELETE FROM ${table}`).run();
    for (const meeting of meetings) refresh(sqlite, meeting);
    const repaired = readIntegrity(sqlite, table);
    if (
      repaired.duplicateRowCount !== 0 ||
      repaired.distinctMeetingCount !== meetings.length
    ) {
      throw new Error(`${table}_integrity_check_failed`);
    }
  })();
  return { rebuilt: true, indexedMeetingCount: meetings.length };
};

export const repairMeetingFtsIndex = (
  sqlite: Database.Database,
  options: { force?: boolean } = {},
) => repairIndex(sqlite, 'meetings_fts', refreshMeetingFts, options.force);

export const repairMeetingNotesFtsIndex = (
  sqlite: Database.Database,
  options: { force?: boolean } = {},
) =>
  repairIndex(
    sqlite,
    'meeting_notes_fts',
    refreshMeetingNotesFts,
    options.force,
  );
