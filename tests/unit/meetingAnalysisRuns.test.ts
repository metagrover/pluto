import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createMeetingAnalysisRunCoordinator } from '../../electron/meetingAnalysisRuns';

describe('meeting analysis run coordinator', () => {
  it.each([false, true])(
    'keeps extracted entities untrusted and publication independent of renderer notification failure (%s)',
    async (notificationFails) => {
      const beginMeetingAnalysisRun = vi.fn();
      const generateStructuredAnalysis = vi.fn().mockResolvedValue({
        analysis_schema_version: 3,
        overview: 'Reviewed notes.',
        topics: [],
        all_action_items: [],
        all_decisions: [],
        meeting_type: 'general',
        quality: {
          format_pass: true,
          retry_count: 0,
          fallback_used: false,
          issues: [],
        },
      });
      const coordinator = createMeetingAnalysisRunCoordinator({
        db: {
          getMeeting: () => ({
            id: 'terms',
            transcript_json: JSON.stringify({
              segments: [{ speaker: 1, text: 'We agreed to ship.' }],
            }),
            transcript_status: 'validated',
            transcript_integrity_json: JSON.stringify({ verified: true }),
            user_notes: 'Please use the spelling Ogletree.',
          }),
          getMeetingAnalysisPublicationRevisions: () => ({
            sourceRevision: 'source-terms',
            eligibilityRevision: 'eligible-terms',
            userNotesHash: 'notes-terms',
          }),
          getMeetingAnalysisRun: () => null,
          beginMeetingAnalysisRun,
          updateMeetingAnalysisRunStatus: vi.fn(),
          updateMeetingAnalysisRunStatusIfCurrent: vi.fn(),
          isMeetingAnalysisRunCurrent: () => true,
          publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
          getAllEntities: () => [{ type: 'person', name: 'Ogletree' }],
        },
        getSettings: async () => ({ llm_provider: 'ollama' }),
        getProvider: async () => ({
          name: 'ollama',
          generateStructuredAnalysis,
        }),
        createRunId: () => 'run-terms',
        onUpdated: () => {
          if (notificationFails) throw new Error('renderer_closed');
        },
      });

      await coordinator.generateAndPublishMeetingNotes({
        meetingId: 'terms',
        requestId: 'request-terms',
        template: 'auto',
        reason: 'manual',
      });

      expect(generateStructuredAnalysis).toHaveBeenCalledWith(
        expect.any(String),
        'Please use the spelling Ogletree.',
        'auto',
        expect.objectContaining({
          knownTerms: ['Ogletree'],
          trustedUserTerms: [],
          entityHints: ['Ogletree'],
        }),
      );
      // The persisted/reusable run identity must invalidate pre-schema outputs.
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            sourceRevision: 'source-terms',
            eligibilityRevision: 'eligible-terms',
            userNotesHash: 'notes-terms',
            terms: ['Ogletree'],
            template: 'auto',
            provider: 'ollama',
            model: 'gemma4:12b',
            thinking: null,
            seed: null,
            contextTokens: 16384,
            promptVersion: 'notes-v28',
          }),
          'utf8',
        )
        .digest('hex');
      expect(beginMeetingAnalysisRun).toHaveBeenCalledWith(
        expect.objectContaining({ inputRevision: fingerprint }),
      );
      expect(generateStructuredAnalysis.mock.calls[0]?.[3].cacheKey).toBe(
        fingerprint,
      );
    },
  );

  it('requires the exact authorized partial-capture-gap lease', async () => {
    const transcriptJson = JSON.stringify({
      segments: [{ speaker: 1, text: 'Recovered discussion.' }],
    });
    const integrityJson = JSON.stringify({
      causes: [{ code: 'capture_gap_detected' }],
    });
    const digest = (value: string) =>
      createHash('sha256').update(value, 'utf8').digest('hex');
    const partialMeeting = {
      id: 'partial',
      transcript_json: transcriptJson,
      transcript_status: 'needs_attention',
      transcript_integrity_json: integrityJson,
      capture_journal_generation: 'journal-1',
      downstream_processing_json: JSON.stringify({
        schemaVersion: 2,
        state: 'processing',
        runId: 'authorized-partial-run',
        startedAt: '2026-08-27T00:00:00.000Z',
        deadlineAt: '2026-08-27T01:00:00.000Z',
        stage: 'analysis',
        attempt: 1,
        source: {
          kind: 'partial_capture_gap',
          captureJournalGeneration: 'journal-1',
          transcriptSha256: digest(transcriptJson),
          transcriptIntegritySha256: digest(integrityJson),
        },
      }),
    };
    const generateStructuredAnalysis = vi.fn().mockResolvedValue({
      analysis_schema_version: 3,
      overview: 'Recovered notes.',
      topics: [],
      all_action_items: [],
      all_decisions: [],
      meeting_type: 'general',
      quality: {
        format_pass: true,
        retry_count: 0,
        fallback_used: false,
        issues: [],
      },
    });
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => partialMeeting,
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'partial-source',
          eligibilityRevision: 'partial-eligibility',
          userNotesHash: 'partial-notes',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn(),
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn(),
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({ name: 'ollama', generateStructuredAnalysis }),
      createRunId: () => 'run-partial',
    });

    await expect(
      coordinator.generateAndPublishMeetingNotes({
        meetingId: 'partial',
        requestId: 'request-partial',
        template: 'auto',
        reason: 'automatic',
      }),
    ).resolves.toMatchObject({ status: 'published' });

    partialMeeting.downstream_processing_json = JSON.stringify({
      schemaVersion: 2,
      state: 'processing',
      source: { kind: 'partial_capture_gap' },
    });
    for (const reason of ['automatic', 'manual'] as const) {
      await expect(
        coordinator.generateAndPublishMeetingNotes({
          meetingId: 'partial',
          requestId: `request-unauthorized-partial-${reason}`,
          template: 'auto',
          reason,
        }),
      ).rejects.toThrow('meeting_notes_source_ineligible');
    }
  });

  it('coalesces identical in-flight requests and publishes only once', async () => {
    let resolveSecondary: (() => void) | null = null;
    const updateSecondaryStatus = vi.fn();
    const runSecondary = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSecondary = resolve;
        }),
    );
    const generateStructuredAnalysis = vi.fn().mockResolvedValue({
      analysis_schema_version: 3,
      overview: 'Reviewed notes.',
      topics: [],
      all_action_items: [],
      all_decisions: [],
      meeting_type: 'general',
      quality: {
        format_pass: true,
        retry_count: 0,
        fallback_used: false,
        issues: [],
      },
    });
    const publishMeetingNotesIfCurrent = vi.fn().mockReturnValue(true);
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'meeting-a',
          title: 'Meeting',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: 'We agreed to ship.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          transcript_validated_at: '2026-08-27T00:00:00.000Z',
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'source-a',
          eligibilityRevision: 'eligible-a',
          userNotesHash: 'notes-a',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn(),
        updateMeetingAnalysisRunStatusIfCurrent: updateSecondaryStatus,
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent,
        getAllEntities: () => [],
      },
      getSettings: async () => ({
        llm_provider: 'ollama',
        ollama_model: 'configured-model',
      }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis,
      }),
      createRunId: () => 'run-a',
      runSecondary,
    });

    const first = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'meeting-a',
      requestId: 'request-a',
      template: 'auto',
      reason: 'automatic',
    });
    const second = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'meeting-a',
      requestId: 'request-b',
      template: 'auto',
      reason: 'automatic',
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { meetingId: 'meeting-a', runId: 'run-a', status: 'published' },
      { meetingId: 'meeting-a', runId: 'run-a', status: 'published' },
    ]);
    expect(generateStructuredAnalysis).toHaveBeenCalledTimes(1);
    expect(publishMeetingNotesIfCurrent).toHaveBeenCalledTimes(1);
    expect(runSecondary).toHaveBeenCalledTimes(1);
    expect(updateSecondaryStatus).toHaveBeenCalledWith(
      expect.objectContaining({ secondaryStatus: 'running' }),
    );
    resolveSecondary?.();
  });

  it('detaches a cancelled subscriber while a coalesced subscriber still receives publication', async () => {
    let resolveGeneration: ((value: Record<string, unknown>) => void) | null =
      null;
    const generateStructuredAnalysis = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveGeneration = resolve;
        }),
    );
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'meeting-b',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: 'We agreed to ship.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          transcript_validated_at: '2026-08-27T00:00:00.000Z',
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'source-b',
          eligibilityRevision: 'eligible-b',
          userNotesHash: 'notes-b',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn(),
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn(),
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({ name: 'ollama', generateStructuredAnalysis }),
      createRunId: () => 'run-b',
    });
    const first = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'meeting-b',
      requestId: 'request-a',
      template: 'auto',
      reason: 'manual',
    });
    const second = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'meeting-b',
      requestId: 'request-b',
      template: 'auto',
      reason: 'manual',
    });

    await vi.waitFor(() => {
      expect(generateStructuredAnalysis).toHaveBeenCalledTimes(1);
    });

    await expect(
      coordinator.cancelMeetingNotes({
        meetingId: 'meeting-b',
        requestId: 'request-a',
      }),
    ).resolves.toEqual({ cancelled: true });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    resolveGeneration?.({
      analysis_schema_version: 3,
      overview: 'Reviewed notes.',
      topics: [],
      all_action_items: [],
      all_decisions: [],
      meeting_type: 'general',
      quality: {
        format_pass: true,
        retry_count: 0,
        fallback_used: false,
        issues: [],
      },
    });
    await expect(second).resolves.toEqual({
      meetingId: 'meeting-b',
      runId: 'run-b',
      status: 'published',
    });
  });

  it('prevents an active run from publishing after notes restoration supersedes it', async () => {
    let resolveGeneration: ((value: Record<string, unknown>) => void) | null =
      null;
    const publishMeetingNotesIfCurrent = vi.fn().mockReturnValue(true);
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'restore-race',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: 'Original transcript.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'restore-source',
          eligibilityRevision: 'restore-eligibility',
          userNotesHash: 'restore-notes',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn(),
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn(),
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent,
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: () =>
          new Promise((resolve) => {
            resolveGeneration = resolve;
          }),
      }),
      createRunId: () => 'restore-run',
    });
    const generation = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'restore-race',
      requestId: 'restore-request',
      template: 'auto',
      reason: 'manual',
    });

    await vi.waitFor(() => expect(resolveGeneration).not.toBeNull());
    expect(coordinator.supersedeMeetingNotes('restore-race')).toBe(true);
    resolveGeneration?.({
      analysis_schema_version: 3,
      overview: 'Stale replacement.',
      topics: [],
      all_action_items: [],
      all_decisions: [],
      meeting_type: 'general',
      quality: {
        format_pass: true,
        retry_count: 0,
        fallback_used: false,
        issues: [],
      },
    });

    await expect(generation).rejects.toMatchObject({ name: 'AbortError' });
    expect(publishMeetingNotesIfCurrent).not.toHaveBeenCalled();
  });

  it('keeps published notes when secondary work fails', async () => {
    const updateSecondaryStatus = vi.fn();
    const publishMeetingNotesIfCurrent = vi.fn().mockReturnValue(true);
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'meeting-c',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: 'We agreed to ship.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          transcript_validated_at: '2026-08-27T00:00:00.000Z',
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'source-c',
          eligibilityRevision: 'eligible-c',
          userNotesHash: 'notes-c',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn(),
        updateMeetingAnalysisRunStatusIfCurrent: updateSecondaryStatus,
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent,
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: async () => ({
          analysis_schema_version: 3,
          overview: 'Reviewed notes.',
          topics: [],
          all_action_items: [],
          all_decisions: [],
          meeting_type: 'general',
          quality: {
            format_pass: true,
            retry_count: 0,
            fallback_used: false,
            issues: [],
          },
        }),
      }),
      createRunId: () => 'run-c',
      runSecondary: async () => {
        throw new Error('value_signals_failed');
      },
    });

    await expect(
      coordinator.generateAndPublishMeetingNotes({
        meetingId: 'meeting-c',
        requestId: 'request-c',
        template: 'auto',
        reason: 'automatic',
      }),
    ).resolves.toEqual({
      meetingId: 'meeting-c',
      runId: 'run-c',
      status: 'published',
    });
    await vi.waitFor(() => {
      expect(updateSecondaryStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          notesStatus: 'published',
          secondaryStatus: 'failed',
          errorCode: 'value_signals_failed',
        }),
      );
    });
    expect(publishMeetingNotesIfCurrent).toHaveBeenCalledTimes(1);
  });
});
