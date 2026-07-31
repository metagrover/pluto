import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-stop-to-validated-db-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => testDatabase.directory,
  },
}));

import {
  claimMeetingTranscriptValidationRetry,
  getMeeting,
  patchStopToValidatedLatency,
  saveDerivedMeetingFieldsIfTranscriptCurrent,
  saveMeeting,
  searchMeetings,
} from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

const createValidatedMeeting = (id: string) => {
  const transcriptJson = JSON.stringify({
    schemaVersion: 2,
    segments: [{ speaker: 'Speaker 1', text: `Transcript ${id}` }],
  });
  const transcriptIntegrityJson = JSON.stringify({
    reasons: [],
    attempts: 1,
  });
  const transcriptValidatedAt = '2026-07-30T08:00:00.000Z';
  saveMeeting({
    id,
    title: `Original ${id}`,
    transcript_json: transcriptJson,
    transcript_integrity_json: transcriptIntegrityJson,
    transcript_validated_at: transcriptValidatedAt,
    transcript_status: 'validated',
    user_notes: `User note ${id}`,
    enhanced_notes: '',
    audio_path: `/private/${id}.wav`,
    folder_id: 'folder-1',
    is_favorite: true,
    finalization_status: 'finalized',
  });
  return { transcriptJson, transcriptIntegrityJson, transcriptValidatedAt };
};

describe('stop-to-validated database persistence', () => {
  it('returns missing when the metric patch row does not exist', () => {
    expect(
      patchStopToValidatedLatency({
        meetingId: 'missing-metric',
        expectedTranscriptJson: '{}',
        expectedTranscriptIntegrityJson: '{}',
        expectedTranscriptValidatedAt: '2026-07-30T08:00:00.000Z',
        replacementTranscriptJson: '{"stopToValidatedLatency":{}}',
      }),
    ).toBe('missing');
  });

  it.each([
    ['transcript JSON', 'wrong-transcript', undefined, undefined],
    ['integrity JSON', undefined, 'wrong-integrity', undefined],
    ['validation timestamp', undefined, undefined, 'wrong-timestamp'],
  ] as const)(
    'rejects an independent %s mismatch',
    (_label, transcriptJson, integrityJson, validatedAt) => {
      const id = `metric-mismatch-${_label.replaceAll(' ', '-')}`;
      const generation = createValidatedMeeting(id);
      expect(
        patchStopToValidatedLatency({
          meetingId: id,
          expectedTranscriptJson: transcriptJson ?? generation.transcriptJson,
          expectedTranscriptIntegrityJson:
            integrityJson ?? generation.transcriptIntegrityJson,
          expectedTranscriptValidatedAt:
            validatedAt ?? generation.transcriptValidatedAt,
          replacementTranscriptJson: JSON.stringify({
            schemaVersion: 2,
            segments: [],
            stopToValidatedLatency: {
              schemaVersion: 1,
              status: 'available',
              durationMs: 45,
            },
          }),
        }),
      ).toBe('conflict');
    },
  );

  it('rejects an independent validation-status mismatch', () => {
    const generation = createValidatedMeeting('metric-status-mismatch');
    const current = getMeeting('metric-status-mismatch') as Record<
      string,
      unknown
    >;
    saveMeeting({
      ...current,
      id: 'metric-status-mismatch',
      title: String(current.title),
      transcript_status: 'needs_attention',
    });

    expect(
      patchStopToValidatedLatency({
        meetingId: 'metric-status-mismatch',
        expectedTranscriptJson: generation.transcriptJson,
        expectedTranscriptIntegrityJson: generation.transcriptIntegrityJson,
        expectedTranscriptValidatedAt: generation.transcriptValidatedAt,
        replacementTranscriptJson: '{"replacement":true}',
      }),
    ).toBe('conflict');
  });

  it('patches only the expected validated transcript generation and preserves retry leases', () => {
    const generation = createValidatedMeeting('metric-generation');
    const replacementTranscriptJson = JSON.stringify({
      schemaVersion: 2,
      segments: [
        { speaker: 'Speaker 1', text: 'Transcript metric-generation' },
      ],
      stopToValidatedLatency: {
        schemaVersion: 1,
        status: 'available',
        durationMs: 45,
      },
    });

    expect(
      patchStopToValidatedLatency({
        meetingId: 'metric-generation',
        expectedTranscriptJson: generation.transcriptJson,
        expectedTranscriptIntegrityJson: generation.transcriptIntegrityJson,
        expectedTranscriptValidatedAt: generation.transcriptValidatedAt,
        replacementTranscriptJson,
      }),
    ).toBe('updated');
    expect(
      patchStopToValidatedLatency({
        meetingId: 'metric-generation',
        expectedTranscriptJson: generation.transcriptJson,
        expectedTranscriptIntegrityJson: generation.transcriptIntegrityJson,
        expectedTranscriptValidatedAt: generation.transcriptValidatedAt,
        replacementTranscriptJson,
      }),
    ).toBe('already_current');

    expect(
      claimMeetingTranscriptValidationRetry('metric-generation', {
        runId: 'retry-after-metric',
        startedAt: '2099-07-30T08:01:00.000Z',
        deadlineAt: '2099-07-30T08:11:00.000Z',
        stage: 'transcribing',
      }),
    ).toBe(true);
    expect(
      patchStopToValidatedLatency({
        meetingId: 'metric-generation',
        expectedTranscriptJson: generation.transcriptJson,
        expectedTranscriptIntegrityJson: generation.transcriptIntegrityJson,
        expectedTranscriptValidatedAt: generation.transcriptValidatedAt,
        replacementTranscriptJson,
      }),
    ).toBe('conflict');
    const claimed = getMeeting('metric-generation') as {
      transcript_json: string;
      transcript_status: string;
    };
    expect(claimed.transcript_status).toBe('validating');
    expect(JSON.parse(claimed.transcript_json)).toMatchObject({
      lifecycleStatus: 'validating',
    });
  });

  it('claims a v2 retry without creating conflicting transcript projections', () => {
    const id = 'v2-retry-projections';
    saveMeeting({
      id,
      title: 'Recovered recording',
      transcript_status: 'needs_attention',
      transcript_validated_at: null,
      transcript_json: JSON.stringify({
        schemaVersion: 2,
        lifecycleStatus: 'needs_attention',
        segments: [],
      }),
      transcript_integrity_json: JSON.stringify({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [{ code: 'recovered_awaiting_validation' }],
        evidenceProvenance: { kind: 'stored_capture_activity_v1' },
      }),
      audio_path: '/private/recovered-mic.wav',
      system_audio_path: '/private/recovered-system.wav',
      finalization_status: 'finalized',
    });

    expect(
      claimMeetingTranscriptValidationRetry(id, {
        runId: 'v2-projection-run',
        startedAt: '2099-07-30T08:01:00.000Z',
        deadlineAt: '2099-07-30T08:11:00.000Z',
        stage: 'transcribing',
      }),
    ).toBe(true);

    const claimed = getMeeting(id) as {
      transcript_status: string;
      transcript_json: string;
      transcript_integrity_json: string;
    };
    expect(claimed.transcript_status).toBe('validating');
    expect(JSON.parse(claimed.transcript_json).lifecycleStatus).toBe(
      'validating',
    );
    expect(JSON.parse(claimed.transcript_integrity_json).state).toBe(
      'validating',
    );
  });

  it('updates every derived analysis field and refreshes FTS without touching owned fields', () => {
    const generation = createValidatedMeeting('derived-generation');
    const result = saveDerivedMeetingFieldsIfTranscriptCurrent({
      meetingId: 'derived-generation',
      expectedTranscriptJson: generation.transcriptJson,
      expectedTranscriptIntegrityJson: generation.transcriptIntegrityJson,
      expectedTranscriptValidatedAt: generation.transcriptValidatedAt,
      expectedTitle: 'Original derived-generation',
      title: 'Generated searchable title',
      enhancedNotes: 'UniqueDerivedSearchMarker',
      analysisJson: JSON.stringify({
        analysis_schema_version: 3,
        generation_metadata: { provider: 'gemini' },
      }),
      analysisSchemaVersion: 3,
      analysisFormatPass: true,
      analysisRetryCount: 2,
      analysisFallbackUsed: true,
      analysisProvider: 'gemini',
      analysisModel: 'gemini-2.5-flash',
      analysisGenerationPath: 'primary',
      analysisPromptVersion: 'analysis-v7',
      analysisGeneratedAt: '2026-07-30T08:02:00.000Z',
      analysisErrorCategoriesJson: JSON.stringify(['format_retry']),
      valueSignalsJson: JSON.stringify({ continuity: [] }),
    });

    expect(result).toBe('updated');
    expect(getMeeting('derived-generation')).toMatchObject({
      title: 'Generated searchable title',
      enhanced_notes: 'UniqueDerivedSearchMarker',
      analysis_schema_version: 3,
      analysis_format_pass: 1,
      analysis_retry_count: 2,
      analysis_fallback_used: 1,
      analysis_provider: 'gemini',
      analysis_model: 'gemini-2.5-flash',
      analysis_generation_path: 'primary',
      analysis_prompt_version: 'analysis-v7',
      analysis_generated_at: '2026-07-30T08:02:00.000Z',
      analysis_error_categories_json: JSON.stringify(['format_retry']),
      transcript_json: generation.transcriptJson,
      transcript_integrity_json: generation.transcriptIntegrityJson,
      transcript_status: 'validated',
      user_notes: 'User note derived-generation',
      audio_path: '/private/derived-generation.wav',
      folder_id: 'folder-1',
      is_favorite: 1,
      finalization_status: 'finalized',
    });
    expect(searchMeetings('UniqueDerivedSearchMarker')).toHaveLength(1);
  });

  it('atomically rejects derived persistence after a retry lease changes the generation', () => {
    const generation = createValidatedMeeting('derived-race');
    expect(
      claimMeetingTranscriptValidationRetry('derived-race', {
        runId: 'retry-before-derived',
        startedAt: '2099-07-30T08:03:00.000Z',
        deadlineAt: '2099-07-30T08:13:00.000Z',
        stage: 'transcribing',
      }),
    ).toBe(true);

    expect(
      saveDerivedMeetingFieldsIfTranscriptCurrent({
        meetingId: 'derived-race',
        expectedTranscriptJson: generation.transcriptJson,
        expectedTranscriptIntegrityJson: generation.transcriptIntegrityJson,
        expectedTranscriptValidatedAt: generation.transcriptValidatedAt,
        expectedTitle: 'Original derived-race',
        title: 'Must not persist',
        enhancedNotes: 'Must not persist',
        analysisJson: '{}',
        analysisSchemaVersion: 3,
        analysisFormatPass: true,
        analysisRetryCount: 0,
        analysisFallbackUsed: false,
        analysisProvider: 'gemini',
        analysisModel: 'model',
        analysisGenerationPath: 'primary',
        analysisPromptVersion: 'v1',
        analysisGeneratedAt: '2026-07-30T08:03:00.000Z',
        analysisErrorCategoriesJson: '[]',
        valueSignalsJson: '{}',
      }),
    ).toBe('conflict');
    expect(getMeeting('derived-race')).toMatchObject({
      title: 'Original derived-race',
      enhanced_notes: '',
      transcript_status: 'validating',
    });
  });

  it('returns missing when the derived update row does not exist', () => {
    expect(
      saveDerivedMeetingFieldsIfTranscriptCurrent({
        meetingId: 'missing-derived',
        expectedTranscriptJson: '{}',
        expectedTranscriptIntegrityJson: '{}',
        expectedTranscriptValidatedAt: '2026-07-30T08:00:00.000Z',
        expectedTitle: 'Missing',
        title: 'Missing',
        enhancedNotes: '',
        analysisJson: '{}',
        analysisSchemaVersion: 3,
        analysisFormatPass: false,
        analysisRetryCount: 0,
        analysisFallbackUsed: false,
        analysisProvider: null,
        analysisModel: null,
        analysisGenerationPath: null,
        analysisPromptVersion: null,
        analysisGeneratedAt: null,
        analysisErrorCategoriesJson: null,
        valueSignalsJson: '{}',
      }),
    ).toBe('missing');
  });
});
