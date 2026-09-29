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
  saveMeeting,
  searchMeetingNotesFts,
} from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
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
