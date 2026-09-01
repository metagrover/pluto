import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-partial-meeting-save-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import { getMeeting, saveMeeting, searchMeetingsFts } from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

const validatedAt = '2026-08-31T12:00:00.000Z';
const originalTranscript = JSON.stringify({
  segments: [{ text: 'durabletranscripttoken' }],
});
const originalIntegrity = JSON.stringify({ schemaVersion: 1 });

const saveCompleteMeeting = (id: string) =>
  saveMeeting({
    id,
    title: 'Original title',
    audio_path: '/audio/mic.wav',
    system_audio_path: '/audio/system.wav',
    mixed_audio_path: '/audio/mixed.wav',
    transcript_json: originalTranscript,
    transcript_status: 'validated',
    transcript_integrity_json: originalIntegrity,
    transcript_validated_at: validatedAt,
  });

describe('generic partial meeting saves', () => {
  it('preserves omitted transcript-owned fields and their search projection', () => {
    const id = 'partial-preserves-transcript';
    saveCompleteMeeting(id);

    saveMeeting({ id, title: 'Late title' });

    expect(getMeeting(id)).toMatchObject({
      title: 'Late title',
      audio_path: '/audio/mic.wav',
      system_audio_path: '/audio/system.wav',
      mixed_audio_path: '/audio/mixed.wav',
      transcript_json: originalTranscript,
      transcript_status: 'validated',
      transcript_integrity_json: originalIntegrity,
      transcript_validated_at: validatedAt,
    });
    expect(searchMeetingsFts('durabletranscripttoken')).toHaveLength(1);
  });

  it('uses explicitly supplied transcript replacement state', () => {
    const id = 'partial-replaces-transcript';
    saveCompleteMeeting(id);
    const replacementTranscript = JSON.stringify({
      segments: [{ text: 'replacement transcript' }],
    });
    const replacementIntegrity = JSON.stringify({ schemaVersion: 1 });

    saveMeeting({
      id,
      title: 'Replacement title',
      audio_path: '/audio/new-mic.wav',
      system_audio_path: '/audio/new-system.wav',
      mixed_audio_path: '/audio/new-mixed.wav',
      transcript_json: replacementTranscript,
      transcript_status: 'needs_attention',
      transcript_integrity_json: replacementIntegrity,
      transcript_validated_at: null,
    });

    expect(getMeeting(id)).toMatchObject({
      audio_path: '/audio/new-mic.wav',
      system_audio_path: '/audio/new-system.wav',
      mixed_audio_path: '/audio/new-mixed.wav',
      transcript_json: replacementTranscript,
      transcript_status: 'needs_attention',
      transcript_integrity_json: replacementIntegrity,
      transcript_validated_at: null,
    });
  });

  it('treats explicit null as an intentional clear for nullable fields', () => {
    const id = 'partial-clears-transcript';
    saveCompleteMeeting(id);

    saveMeeting({
      id,
      title: 'Cleared transcript',
      audio_path: null,
      system_audio_path: null,
      mixed_audio_path: null,
      transcript_json: null,
      transcript_status: null,
      transcript_integrity_json: null,
      transcript_validated_at: null,
    });

    expect(getMeeting(id)).toMatchObject({
      audio_path: null,
      system_audio_path: null,
      mixed_audio_path: null,
      transcript_json: null,
      transcript_status: null,
      transcript_integrity_json: null,
      transcript_validated_at: null,
    });
  });

  it('uses the provisional status default when a new meeting omits status', () => {
    const id = 'new-meeting-default-status';

    saveMeeting({ id, title: 'New meeting' });

    expect(getMeeting(id)).toMatchObject({
      transcript_status: 'provisional',
    });
  });
});
