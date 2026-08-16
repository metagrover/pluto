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
    expect(derivedBoundary).toContain('refreshMeetingFts(updated)');
    for (const field of [
      'analysis_provider = ?',
      'analysis_model = ?',
      'analysis_generation_path = ?',
      'analysis_prompt_version = ?',
      'analysis_generated_at = ?',
      'analysis_error_categories_json = ?',
    ]) {
      expect(derivedBoundary).toContain(field);
    }
  });

  it('hands analysis only the generation-bound canonical commit', () => {
    const finalWorker = readFileSync(
      'src/services/finalTranscription/runPersistedMeetingFinalTranscription.ts',
      'utf8',
    );
    const audioManager = readFileSync(
      'src/components/AudioManager.tsx',
      'utf8',
    );
    const downstream = readFileSync(
      'src/services/processValidatedMeetingDownstream.ts',
      'utf8',
    );
    const boundary = finalWorker.slice(
      finalWorker.indexOf('commitCanonical: async (commit)'),
      finalWorker.indexOf('markNeedsAttention: async'),
    );

    expect(boundary).toContain("'COMMIT_FINAL_TRANSCRIPTION'");
    expect(boundary).toContain('captureGeneration');
    expect(boundary).toContain('outcome.committed === true');
    expect(boundary).toContain(
      'outcome.transcriptJson || canonicalTranscriptJson',
    );
    expect(finalWorker).toContain('processValidatedMeetingDownstream');
    expect(downstream).not.toContain('TRANSCRIPTION_TRANSCRIBE');
    expect(audioManager).not.toContain("'AUDIO_DELETE_FILES'");
    expect(audioManager).not.toContain("'EXTRACT_AND_PROCESS_ENTITIES'");
  });
});
