import {
  type MeetingNotesEvidenceSource,
  buildMeetingNotesEvidenceDocument,
} from '../intelligence/meetingNotesEvidence';
import type { PlutoMcpDataSource } from './types';

// Accept the already initialized application database. Opening it or using the
// general meeting APIs here could run migrations or transcript retry recovery.
type ReadDatabase = {
  prepare(sql: string): {
    all(...parameters: (string | number)[]): unknown[];
    get(...parameters: (string | number)[]): unknown;
  };
};

type NotesRow = MeetingNotesEvidenceSource & {
  started_at: string | null;
  created_at: string | null;
};

// Raw analysis and edits are internal inputs to the existing notes renderer;
// only its settled notes text and explicit metadata may cross the MCP boundary.
const NOTES_COLUMNS = `id, title, started_at, created_at, user_notes,
  enhanced_notes, analysis_json, user_edits_json, analysis_format_pass`;
const NOTES_ORDER = 'ORDER BY COALESCE(started_at, created_at) DESC, id ASC';
const SCAN_PAGE_SIZE = 10;

function pageInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `Pagination values must be integers of at least ${minimum}.`,
    );
  }
  return Math.min(value, maximum);
}

function render(row: NotesRow) {
  const document = buildMeetingNotesEvidenceDocument(row);
  return {
    metadata: {
      meetingId: String(row.id),
      sourceId: `pluto://meetings/${encodeURIComponent(String(row.id))}/notes`,
      title: document.title,
      date: row.started_at || row.created_at || null,
      hasNotes: Boolean(document.notesText.trim()),
    },
    document,
  };
}

function notesSnippet(notes: string, query: string): string {
  const match = notes.toLocaleLowerCase().indexOf(query);
  const start = match < 0 ? 0 : Math.max(0, match - 120);
  const end = Math.min(notes.length, start + 500);
  return `${start ? '…' : ''}${notes.slice(start, end)}${end < notes.length ? '…' : ''}`;
}

export function createPlutoMcpDataSource(
  database: ReadDatabase,
): PlutoMcpDataSource {
  const page = database.prepare(
    `SELECT ${NOTES_COLUMNS} FROM meetings ${NOTES_ORDER} LIMIT ? OFFSET ?`,
  );
  const count = database.prepare('SELECT COUNT(*) AS total FROM meetings');
  const one = database.prepare(
    `SELECT ${NOTES_COLUMNS} FROM meetings WHERE id = ?`,
  );

  return {
    listMeetings(input, signal) {
      signal?.throwIfAborted();
      const limit = pageInteger(input.limit, 20, 1, 100);
      const offset = pageInteger(input.offset, 0, 0, 1_000_000);
      const total = (count.get() as { total: number }).total;
      const meetings = (page.all(limit, offset) as NotesRow[]).map(
        (row) => render(row).metadata,
      );
      return {
        meetings,
        total,
        offset,
        limit,
        nextOffset:
          offset + meetings.length < total ? offset + meetings.length : null,
      };
    },

    async searchMeetings(input, signal) {
      signal?.throwIfAborted();
      if (typeof input.query !== 'string' || !input.query.trim()) {
        throw new Error('A non-empty plain-text query is required.');
      }
      if (input.query.length > 1000) {
        throw new Error('Search queries must be at most 1000 characters.');
      }
      const query = input.query.trim().toLocaleLowerCase();
      const limit = pageInteger(input.limit, 20, 1, 100);
      const offset = pageInteger(input.offset, 0, 0, 1_000_000);
      const meetings: Record<string, unknown>[] = [];
      let total = 0;

      // A raw FTS/LIKE prefilter can miss replacement edits or resurrect deleted
      // wording. Render each current notes document before literal matching.
      for (let scanOffset = 0; ; scanOffset += SCAN_PAGE_SIZE) {
        signal?.throwIfAborted();
        const rows = page.all(SCAN_PAGE_SIZE, scanOffset) as NotesRow[];
        signal?.throwIfAborted();
        for (const row of rows) {
          const { metadata, document } = render(row);
          const matches = `${metadata.title}\n${document.notesText}`
            .toLocaleLowerCase()
            .includes(query);
          if (!matches) continue;
          if (total >= offset && meetings.length < limit) {
            meetings.push({
              ...metadata,
              snippet: notesSnippet(document.notesText, query),
            });
          }
          total += 1;
        }
        if (rows.length < SCAN_PAGE_SIZE) break;
        // Let capture/IPC callbacks run between small render batches. Do not
        // hold a database transaction or open another database across this wait.
        await setImmediate();
        signal?.throwIfAborted();
      }
      return {
        meetings,
        total,
        scanComplete: true,
        offset,
        limit,
        nextOffset:
          offset + meetings.length < total ? offset + meetings.length : null,
      };
    },

    getMeeting(input, signal) {
      signal?.throwIfAborted();
      if (
        typeof input.meetingId !== 'string' ||
        !input.meetingId.trim() ||
        input.meetingId.length > 200
      ) {
        throw new Error('A meeting ID of 1 to 200 characters is required.');
      }
      const offset = pageInteger(input.offset, 0, 0, 10_000_000);
      const limit = pageInteger(input.limit, 12000, 1, 20000);
      const row = one.get(input.meetingId) as NotesRow | undefined;
      if (!row) throw new Error('Meeting not found.');
      const { metadata, document } = render(row);
      const totalCharacters = document.notesText.length;
      const notes = document.notesText.slice(offset, offset + limit);
      return {
        ...metadata,
        notes,
        sourceRevision: document.sourceRevision,
        trustStatus: document.trustStatus,
        totalCharacters,
        offset,
        limit,
        nextOffset:
          offset + notes.length < totalCharacters
            ? offset + notes.length
            : null,
      };
    },
  };
}
import { setImmediate } from 'node:timers/promises';
