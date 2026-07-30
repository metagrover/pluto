import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stop-to-validated persistence boundary', () => {
  it('keeps metric and derived writes transcript-generation guarded', () => {
    const database = readFileSync('electron/db.ts', 'utf8');
    const metricBoundary = database.slice(
      database.indexOf('export const patchStopToValidatedLatency'),
      database.indexOf(
        'export const saveDerivedMeetingFieldsIfTranscriptCurrent',
      ),
    );
    const derivedBoundary = database.slice(
      database.indexOf(
        'export const saveDerivedMeetingFieldsIfTranscriptCurrent',
      ),
      database.indexOf('export const updateMeetingFollowUpDrafts'),
    );

    for (const boundary of [metricBoundary, derivedBoundary]) {
      expect(boundary).toContain('transcript_json = ?');
      expect(boundary).toContain('transcript_integrity_json = ?');
      expect(boundary).toContain('transcript_validated_at = ?');
      expect(boundary).toContain("transcript_status = 'validated'");
    }
    const setClause = derivedBoundary.split('WHERE')[0] || '';
    expect(setClause).not.toMatch(/transcript_json\s*=/);
    expect(setClause).not.toMatch(/user_notes\s*=/);
    expect(setClause).not.toMatch(/audio_path\s*=/);
  });

  it('refreshes canonical provenance and search state after a guarded derived update', () => {
    const database = readFileSync('electron/db.ts', 'utf8');
    const derivedBoundary = database.slice(
      database.indexOf(
        'export const saveDerivedMeetingFieldsIfTranscriptCurrent',
      ),
      database.indexOf('export const updateMeetingFollowUpDrafts'),
    );

    expect(derivedBoundary).toContain('db.transaction');
    expect(derivedBoundary).toContain('saveMeetingTransaction(updated)');
  });

  it('suppresses cleanup and downstream persistence on reconciliation conflicts', () => {
    const audioManager = readFileSync(
      'src/components/AudioManager.tsx',
      'utf8',
    );
    const boundary = audioManager.slice(
      audioManager.indexOf(
        'const metricPatchPromise = window.ipcRenderer.invoke',
      ),
      audioManager.indexOf(
        "console.log(\n        '[Pluto] Session saved to DB with transcript segments:'",
      ),
    );

    expect(boundary).toContain("metricPatchOutcome !== 'updated'");
    expect(boundary).toContain("derivedPersistenceOutcome !== 'updated'");
    expect(
      boundary.match(/onSessionComplete\?\.\(meetingData\.id\);\s*return;/g),
    ).toHaveLength(2);
  });
});
