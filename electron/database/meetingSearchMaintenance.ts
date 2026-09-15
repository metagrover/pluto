import type Database from 'better-sqlite3';
import type { PersistedMeeting } from '../db';
import type { MidFrontmatter } from '../intelligence/intelligenceTypes';
import { buildMeetingNotesEvidenceDocument } from '../intelligence/meetingNotesEvidence';

export interface SearchIndexIntegrity {
  rowCount: number;
  distinctMeetingCount: number;
  duplicateRowCount: number;
}

export interface MeetingContextSectionRow {
  id: string;
  meeting_id: string;
  section_id: string;
  heading: string;
  kind: string;
  summary: string;
  content: string;
  entities_text: string;
  evidence_json: string;
  transcript_start_index: number | null;
  transcript_end_index: number | null;
  source_revision: string;
  trust_status: 'grounded' | 'needs_review';
  updated_at: string;
}

export interface MeetingContextSectionIntegrity {
  rowCount: number;
  distinctMeetingCount: number;
  duplicateRowCount: number;
  staleMeetingCount: number;
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

export const refreshMeetingContextSections = (
  sqlite: Database.Database,
  meeting: PersistedMeeting,
  speakerDisplayNames: Readonly<Record<string, string>> = {},
): void => {
  const document = buildMeetingNotesEvidenceDocument(
    meeting,
    speakerDisplayNames,
  );
  sqlite
    .prepare('DELETE FROM meeting_context_sections_fts WHERE meeting_id = ?')
    .run(document.meetingId);
  sqlite
    .prepare('DELETE FROM meeting_context_sections WHERE meeting_id = ?')
    .run(document.meetingId);

  const insertSection = sqlite.prepare(`
    INSERT INTO meeting_context_sections (
      id, meeting_id, section_id, heading, kind, summary, content,
      entities_text, evidence_json, transcript_start_index,
      transcript_end_index, source_revision, trust_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSearch = sqlite.prepare(`
    INSERT INTO meeting_context_sections_fts (
      heading, summary, content, entities_text, meeting_id, section_id
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updatedAt = new Date().toISOString();
  for (const section of document.sections) {
    const id = `${document.meetingId}:${section.sectionId}`;
    insertSection.run(
      id,
      document.meetingId,
      section.sectionId,
      section.heading,
      section.kind,
      section.summary,
      section.content,
      section.entitiesText,
      JSON.stringify(section.evidenceReferences),
      section.transcriptRange?.[0] ?? null,
      section.transcriptRange?.[1] ?? null,
      document.sourceRevision,
      document.trustStatus,
      updatedAt,
    );
    insertSearch.run(
      section.heading,
      section.summary,
      section.content,
      section.entitiesText,
      document.meetingId,
      section.sectionId,
    );
  }
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
    refreshMeetingContextSections(sqlite, meeting, speakerDisplayNames);
  })();
};

export const getMeetingFtsIntegrity = (
  sqlite: Database.Database,
): SearchIndexIntegrity => readIntegrity(sqlite, 'meetings_fts');

export const getMeetingNotesFtsIntegrity = (
  sqlite: Database.Database,
): SearchIndexIntegrity => readIntegrity(sqlite, 'meeting_notes_fts');

export const getMeetingContextSectionIntegrity = (
  sqlite: Database.Database,
): MeetingContextSectionIntegrity => {
  const rows = sqlite
    .prepare(
      `SELECT meeting_id, COUNT(*) AS section_count,
              COUNT(DISTINCT source_revision) AS revision_count
       FROM meeting_context_sections GROUP BY meeting_id`,
    )
    .all() as Array<{
    meeting_id: string;
    section_count: number;
    revision_count: number;
  }>;
  return {
    rowCount: rows.reduce((total, row) => total + row.section_count, 0),
    distinctMeetingCount: rows.length,
    duplicateRowCount: 0,
    staleMeetingCount: rows.filter((row) => row.revision_count !== 1).length,
  };
};

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

export const repairMeetingContextSectionIndex = (
  sqlite: Database.Database,
  options: { force?: boolean } = {},
): { rebuilt: boolean; indexedMeetingCount: number; sectionCount: number } => {
  const meetings = sqlite
    .prepare('SELECT * FROM meetings')
    .all() as PersistedMeeting[];
  const expected = meetings.map((meeting) => ({
    meeting,
    document: buildMeetingNotesEvidenceDocument(meeting),
  }));
  const indexed = sqlite
    .prepare(
      `SELECT meeting_id, source_revision, COUNT(*) AS section_count
       FROM meeting_context_sections
       GROUP BY meeting_id, source_revision`,
    )
    .all() as Array<{
    meeting_id: string;
    source_revision: string;
    section_count: number;
  }>;
  const indexedByMeeting = new Map(indexed.map((row) => [row.meeting_id, row]));
  const current =
    indexed.length ===
      expected.filter(({ document }) => document.sections.length).length &&
    expected.every(({ meeting, document }) => {
      const row = indexedByMeeting.get(String(meeting.id));
      return document.sections.length === 0
        ? !row
        : row?.source_revision === document.sourceRevision &&
            row.section_count === document.sections.length;
    });
  if (!options.force && current) {
    return {
      rebuilt: false,
      indexedMeetingCount: indexed.length,
      sectionCount: indexed.reduce(
        (total, row) => total + row.section_count,
        0,
      ),
    };
  }

  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM meeting_context_sections_fts').run();
    sqlite.prepare('DELETE FROM meeting_context_sections').run();
    for (const meeting of meetings) {
      refreshMeetingContextSections(sqlite, meeting);
    }
  })();
  const repaired = getMeetingContextSectionIntegrity(sqlite);
  return {
    rebuilt: true,
    indexedMeetingCount: repaired.distinctMeetingCount,
    sectionCount: repaired.rowCount,
  };
};
