import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';

import type { NotesStageEvent } from '../../electron/llm/meetingNotesRunMetrics';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import {
  createMeetingNotesTemplateSettingsSnapshot,
  resolveMeetingNotesTemplate,
} from '../../electron/llm/meetingNotesTemplates';
import {
  createMeetingAnalysisRunCoordinator,
  shouldUseMeetingNotesOptionalReviewBudget,
} from '../../electron/meetingAnalysisRuns';

describe('meeting analysis run coordinator', () => {
  const autoTemplate = resolveMeetingNotesTemplate(
    createMeetingNotesTemplateSettingsSnapshot('auto', {}),
    'auto',
  );
  const autoTemplateIdentity = {
    id: autoTemplate.id,
    revision: autoTemplate.revision,
  };
  it('keeps draft previews in memory only and clears them at publication', async () => {
    let running = false;
    let current = true;
    const checkCurrent = vi.fn(() => current);
    const publish = vi.fn().mockImplementation(() => {
      running = false;
      return true;
    });
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'preview-meeting',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 'Them', text: 'We agreed to ship.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'source',
          eligibilityRevision: 'eligibility',
          userNotesHash: 'notes',
        }),
        getMeetingAnalysisRun: () =>
          running
            ? {
                run_id: 'preview-run',
                input_revision: 'revision',
                notes_status: 'running',
              }
            : null,
        beginMeetingAnalysisRun: () => {
          running = true;
        },
        updateMeetingAnalysisRunStatus: () => true,
        updateMeetingAnalysisRunStatusIfCurrent: () => true,
        isMeetingAnalysisRunCurrent: checkCurrent,
        publishMeetingNotesIfCurrent: publish,
        getAllEntities: () => [],
        getMeetingNotesIdentityProjection: () => ({
          speakerDisplayNames: { Them: 'Alex' },
          trustedUserTerms: ['Alex'],
        }),
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      createRunId: () => 'preview-run',
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: async (
          transcript,
          _notes,
          _template,
          options,
        ) => {
          expect(transcript).toBe('Alex: We agreed to ship.');
          expect(options?.source?.segments[0]?.speaker).toBe('Alex');
          expect(options?.trustedUserTerms).toEqual(['Alex']);
          const draft = {
            meetingType: 'general' as const,
            overview: null,
            sections: [
              { title: { text: 'Preview only', sources: [] }, items: [] },
            ],
          };
          checkCurrent.mockClear();
          for (let index = 0; index < 20; index++) options?.onDraft?.(draft);
          expect(checkCurrent).not.toHaveBeenCalled();
          expect(
            coordinator.getMeetingNotesPreview('preview-meeting')?.sections[0]
              .title,
          ).toBe('Preview only');
          expect(checkCurrent).toHaveBeenCalledOnce();
          expect(publish).not.toHaveBeenCalled();
          current = false;
          expect(
            coordinator.getMeetingNotesPreview('preview-meeting'),
          ).toBeNull();
          current = true;
          options?.onDraft?.(draft);
          return {
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
          };
        },
      }),
    });
    await coordinator.generateAndPublishMeetingNotes({
      meetingId: 'preview-meeting',
      requestId: 'preview-request',
      template: 'auto',
      reason: 'manual',
    });
    expect(coordinator.getMeetingNotesPreview('preview-meeting')).toBeNull();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(publish.mock.calls)).not.toContain('Preview only');
  });

  it('publishes grounded speaker references for later identity projection', async () => {
    let running = false;
    const publish = vi.fn().mockImplementation(() => {
      running = false;
      return true;
    });
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'speaker-reference-meeting',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 'Me', text: 'My project is ready.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'source',
          eligibilityRevision: 'eligibility',
          userNotesHash: 'notes',
        }),
        getMeetingAnalysisRun: () =>
          running
            ? {
                run_id: 'speaker-reference-run',
                input_revision: 'revision',
                notes_status: 'running',
              }
            : null,
        beginMeetingAnalysisRun: () => {
          running = true;
        },
        updateMeetingAnalysisRunStatus: () => true,
        updateMeetingAnalysisRunStatusIfCurrent: () => true,
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: publish,
        getAllEntities: () => [],
        getMeetingNotesIdentityProjection: () => ({
          speakerDisplayNames: { Me: 'Alex' },
          trustedUserTerms: ['Alex'],
        }),
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      createRunId: () => 'speaker-reference-run',
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: async () => ({
          analysis_schema_version: 3,
          overview: "Alex's project is ready.",
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
          generation_metadata: {
            provider: 'ollama',
            model: 'test',
            generation_path: 'single_pass',
            prompt_version: 'test',
            generated_at: '2026-09-13T00:00:00.000Z',
            error_categories: [],
            source_provenance: {
              schema_version: 1,
              source_revision: 'source',
              blocks: {
                overview: {
                  id: 'overview',
                  sources: [{ segment: 0, start: 0, end: 20 }],
                },
              },
            },
          },
        }),
      }),
    });

    await coordinator.generateAndPublishMeetingNotes({
      meetingId: 'speaker-reference-meeting',
      requestId: 'speaker-reference-request',
      template: 'auto',
      reason: 'automatic',
    });

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis: expect.objectContaining({
          generation_metadata: expect.objectContaining({
            speaker_references: {
              schema_version: 1,
              blocks: {
                overview: [
                  {
                    speaker: 'Me',
                    sourceName: 'Alex',
                    start: 0,
                    end: 4,
                  },
                ],
              },
            },
          }),
        }),
      }),
    );
  });

  it('allows an in-flight run to publish and build references when speaker identity projection updates mid-generation', async () => {
    let running = false;
    let projection = {
      speakerDisplayNames: {} as Record<string, string>,
      trustedUserTerms: [] as string[],
    };
    const publish = vi.fn().mockImplementation(() => {
      running = false;
      return true;
    });
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'parallel-meeting',
          transcript_json: JSON.stringify({
            segments: [
              {
                speaker: 'Remote Speaker 1',
                text: 'We agreed to ship Friday.',
              },
            ],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'canonical-source-rev',
          eligibilityRevision: 'eligibility',
          userNotesHash: 'notes',
        }),
        getMeetingAnalysisRun: () =>
          running
            ? {
                run_id: 'parallel-run',
                input_revision: 'revision',
                notes_status: 'running',
              }
            : null,
        beginMeetingAnalysisRun: () => {
          running = true;
        },
        updateMeetingAnalysisRunStatus: () => true,
        updateMeetingAnalysisRunStatusIfCurrent: () => true,
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: publish,
        getAllEntities: () => [],
        getMeetingNotesIdentityProjection: () => projection,
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      createRunId: () => 'parallel-run',
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: async () => {
          // Mid-generation, user confirms Remote Speaker 1 as Alice
          projection = {
            speakerDisplayNames: { 'Remote Speaker 1': 'Alice' },
            trustedUserTerms: ['Alice'],
          };
          return {
            analysis_schema_version: 3,
            overview: 'Remote Speaker 1 agreed to ship Friday.',
            topics: [],
            all_action_items: [
              { text: 'Ship Friday.', assignee: 'Remote Speaker 1' },
            ],
            all_decisions: [],
            meeting_type: 'general',
            quality: {
              format_pass: true,
              retry_count: 0,
              fallback_used: false,
              issues: [],
            },
            generation_metadata: {
              provider: 'ollama',
              model: 'test',
              generation_path: 'single_pass',
              prompt_version: 'test',
              generated_at: '2026-09-15T00:00:00.000Z',
              error_categories: [],
              source_provenance: {
                schema_version: 1,
                source_revision: 'canonical-source-rev',
                blocks: {
                  overview: {
                    id: 'overview',
                    sources: [{ segment: 0, start: 0, end: 25 }],
                  },
                  'all_action_items:0': {
                    id: 'action-0',
                    sources: [{ segment: 0, start: 0, end: 25 }],
                  },
                },
              },
            },
          };
        },
      }),
    });

    const result = await coordinator.generateAndPublishMeetingNotes({
      meetingId: 'parallel-meeting',
      requestId: 'parallel-request',
      template: 'auto',
      reason: 'automatic',
    });

    expect(result.status).toBe('published');
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis: expect.objectContaining({
          generation_metadata: expect.objectContaining({
            speaker_references: {
              schema_version: 1,
              blocks: expect.objectContaining({
                overview: [
                  {
                    speaker: 'Remote Speaker 1',
                    sourceName: 'Remote Speaker 1',
                    start: 0,
                    end: 16,
                  },
                ],
                'all_action_items:0:assignee': [
                  {
                    speaker: 'Remote Speaker 1',
                    sourceName: 'Remote Speaker 1',
                    start: 0,
                    end: 16,
                  },
                ],
              }),
            },
          }),
        }),
      }),
    );
  });

  it.each(['success', 'failure', 'superseded', 'inline'])(
    'publishes notes with an inline title or without waiting for a fallback (%s)',
    async (outcome) => {
      let running = false;
      const publish = vi.fn().mockImplementation(() => {
        running = false;
        return true;
      });
      let resolveTitle!: (title: string) => void;
      let rejectTitle!: (error: Error) => void;
      let current = true;
      const saveTitle = vi.fn().mockReturnValue(true);
      const generateTitle = vi.fn(
        () =>
          new Promise<string>((resolve, reject) => {
            resolveTitle = resolve;
            rejectTitle = reject;
          }),
      );
      const coordinator = createMeetingAnalysisRunCoordinator({
        db: {
          getMeeting: () => ({
            id: 'recovered-meeting',
            title: 'Recovered recording',
            transcript_json: JSON.stringify({
              segments: [{ speaker: 'Them', text: 'We reviewed the roadmap.' }],
            }),
            transcript_status: 'validated',
            transcript_integrity_json: JSON.stringify({ verified: true }),
            user_notes: '',
          }),
          getMeetingAnalysisPublicationRevisions: () => ({
            sourceRevision: 'source',
            eligibilityRevision: 'eligibility',
            userNotesHash: 'notes',
          }),
          getMeetingAnalysisRun: () =>
            running
              ? {
                  run_id: 'title-run',
                  input_revision: 'revision',
                  notes_status: 'running',
                }
              : null,
          beginMeetingAnalysisRun: () => {
            running = true;
          },
          updateMeetingAnalysisRunStatus: () => true,
          updateMeetingAnalysisRunStatusIfCurrent: () => true,
          isMeetingAnalysisRunCurrent: () => current,
          saveMeetingAnalysisSecondaryFieldsIfCurrent: saveTitle,
          publishMeetingNotesIfCurrent: publish,
          getAllEntities: () => [],
          getMeetingNotesIdentityProjection: () => ({
            speakerDisplayNames: {},
            trustedUserTerms: [],
          }),
        },
        getSettings: async () => ({ llm_provider: 'ollama' }),
        createRunId: () => 'title-run',
        getProvider: async () => ({
          name: 'ollama',
          generateTitle,
          generateStructuredAnalysis: async () => ({
            analysis_schema_version: 3,
            ...(outcome === 'inline'
              ? { title: 'Quarterly Roadmap Review' }
              : {}),
            overview: 'The quarterly roadmap was reviewed.',
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
      });

      await coordinator.generateAndPublishMeetingNotes({
        meetingId: 'recovered-meeting',
        requestId: 'title-request',
        template: 'auto',
        reason: 'automatic',
      });

      if (outcome === 'inline') {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(publish).toHaveBeenCalledOnce();
        expect(publish.mock.calls[0][0].analysis.title).toBe(
          'Quarterly Roadmap Review',
        );
        expect(generateTitle).not.toHaveBeenCalled();
        expect(saveTitle).not.toHaveBeenCalled();
        return;
      }
      expect(generateTitle).toHaveBeenCalledWith(
        'The quarterly roadmap was reviewed.',
      );
      expect(publish).toHaveBeenCalledOnce();
      expect(publish.mock.calls[0][0].analysis.title).toBeUndefined();
      expect(saveTitle).not.toHaveBeenCalled();
      if (outcome === 'failure') rejectTitle(new Error('title unavailable'));
      else {
        if (outcome === 'superseded') current = false;
        resolveTitle('Quarterly Roadmap Review');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (outcome === 'success') {
        expect(saveTitle).toHaveBeenCalledWith(
          expect.objectContaining({
            runId: 'title-run',
            generatedTitle: {
              expectedTitle: 'Recovered recording',
              title: 'Quarterly Roadmap Review',
            },
          }),
        );
      } else expect(saveTitle).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledOnce();
    },
  );

  it('applies the optional review budget only to the local Ollama provider', () => {
    expect(shouldUseMeetingNotesOptionalReviewBudget('Ollama (Local)')).toBe(
      true,
    );
    expect(shouldUseMeetingNotesOptionalReviewBudget('ollama')).toBe(true);
    expect(shouldUseMeetingNotesOptionalReviewBudget('OpenAI')).toBe(false);
    expect(shouldUseMeetingNotesOptionalReviewBudget('Anthropic Claude')).toBe(
      false,
    );
  });

  it('retains exact completed writers for two hours without extending model residency', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    const precompute = vi.fn().mockResolvedValue('generated');
    const { source, draft } = makeDirectNotesFixture();
    try {
      const coordinator = createMeetingAnalysisRunCoordinator({
        db: {
          getMeeting: vi.fn(),
          getMeetingAnalysisPublicationRevisions: vi.fn(),
          getMeetingAnalysisRun: vi.fn(),
          beginMeetingAnalysisRun: vi.fn(),
          updateMeetingAnalysisRunStatus: vi.fn(),
          updateMeetingAnalysisRunStatusIfCurrent: vi.fn(),
          isMeetingAnalysisRunCurrent: vi.fn(),
          publishMeetingNotesIfCurrent: vi.fn(),
          getAllEntities: () => [],
        },
        getSettings: async () => ({ llm_provider: 'ollama' }),
        getProvider: async () => ({
          name: 'ollama',
          generateStructuredAnalysis: vi.fn(),
          precomputeStructuredAnalysisLeaf: precompute,
        }),
      });
      await coordinator.precomputeIncrementalMeetingNotes({
        source,
        userNotes: '',
        signal: new AbortController().signal,
      });
      const cache = precompute.mock.calls[0][3].stageCache;
      cache.set('exact-writer-key', draft);
      clock.mockReturnValue(90 * 60 * 1000);
      expect(cache.get('exact-writer-key')).toEqual(draft);
      clock.mockReturnValue(2 * 60 * 60 * 1000);
      expect(cache.get('exact-writer-key')).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });

  it('precomputes a live leaf with the same source-independent cache identity used at publication', async () => {
    const precomputeStructuredAnalysisLeaf = vi
      .fn()
      .mockResolvedValue('generated');
    const db = {
      getMeeting: vi.fn(),
      getMeetingAnalysisPublicationRevisions: vi.fn(),
      getMeetingAnalysisRun: vi.fn(),
      beginMeetingAnalysisRun: vi.fn(),
      updateMeetingAnalysisRunStatus: vi.fn(),
      updateMeetingAnalysisRunStatusIfCurrent: vi.fn(),
      isMeetingAnalysisRunCurrent: vi.fn(),
      publishMeetingNotesIfCurrent: vi.fn(),
      getAllEntities: () => [{ type: 'project', name: 'Apollo' }],
    };
    const coordinator = createMeetingAnalysisRunCoordinator({
      db,
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: vi.fn(),
        precomputeStructuredAnalysisLeaf,
      }),
    });
    const source = createNotesSource(
      JSON.stringify({
        segments: [{ speaker: 'Milo', text: 'Accepted live transcript.' }],
      }),
    );

    await expect(
      coordinator.precomputeIncrementalMeetingNotes({
        source,
        userNotes: 'Use Apollo terminology.',
        template: 'auto',
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('generated');

    expect(precomputeStructuredAnalysisLeaf).toHaveBeenCalledWith(
      '',
      'Use Apollo terminology.',
      'auto',
      expect.objectContaining({
        source,
        knownTerms: ['Apollo'],
        entityHints: ['Apollo'],
        trustedUserTerms: [],
        contextTokens: 16_384,
        compactWriterContract: true,
        stageCache: expect.anything(),
        cacheKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        workClass: 'automatic_notes',
      }),
    );
  });

  it('persists one content-free terminal metric from provider stage events', async () => {
    const upsertMeetingAnalysisRunMetric = vi.fn();
    const knowledgePause = { acquire: vi.fn(), release: vi.fn() };
    const generateStructuredAnalysis = vi.fn(
      async (
        _transcript: string,
        _notes: string,
        _template: string,
        options: {
          onStageEvent?: (event: NotesStageEvent) => void;
        },
      ) => {
        options.onStageEvent?.({
          phase: 'queued',
          sequence: 0,
          task: 'notesWriter',
          atMs: 100,
        });
        options.onStageEvent?.({ phase: 'started', sequence: 0, atMs: 125 });
        options.onStageEvent?.({
          phase: 'finished',
          sequence: 0,
          atMs: 225,
          outcome: 'complete',
          inputTokens: 200,
          outputTokens: 50,
        });
        return {
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
        };
      },
    );
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'metric-run',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: 'We agreed to ship.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'metric-source',
          eligibilityRevision: 'metric-eligibility',
          userNotesHash: 'metric-notes',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn().mockReturnValue(true),
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn().mockReturnValue(true),
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
        getAllEntities: () => [],
        upsertMeetingAnalysisRunMetric,
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis,
      }),
      knowledgeSynthesisPause: knowledgePause,
      createRunId: () => 'metric-run-id',
    });

    await coordinator.generateAndPublishMeetingNotes({
      meetingId: 'metric-run',
      requestId: 'metric-request',
      template: 'auto',
      reason: 'manual',
    });

    expect(generateStructuredAnalysis).toHaveBeenCalledWith(
      expect.any(String),
      '',
      'auto',
      expect.objectContaining({
        optionalReviewDeadlineAtMs: expect.any(Number),
        optionalReviewMinStartMs: 5 * 60_000,
      }),
    );
    expect(knowledgePause.acquire).toHaveBeenCalledWith('meeting_notes_run');
    expect(knowledgePause.release).toHaveBeenCalledWith('meeting_notes_run');

    expect(upsertMeetingAnalysisRunMetric).toHaveBeenCalledTimes(1);
    expect(upsertMeetingAnalysisRunMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 'metric-run',
        runId: 'metric-run-id',
        reason: 'manual',
        status: 'published',
        metrics: expect.objectContaining({
          sourceSegmentCount: 1,
          sourceCharacterCount: 18,
          queueMs: expect.any(Number),
          modelMs: 100,
          stages: [
            expect.objectContaining({
              task: 'notesWriter',
              outcome: 'complete',
              inputTokens: 200,
              outputTokens: 50,
            }),
          ],
        }),
      }),
    );
    expect(
      JSON.stringify(upsertMeetingAnalysisRunMetric.mock.calls),
    ).not.toContain('We agreed to ship.');
    expect(
      upsertMeetingAnalysisRunMetric.mock.calls[0]![0].metrics.queueMs,
    ).toBeGreaterThanOrEqual(25);
  });

  it('does not let terminal metric persistence failure replace a deletion cancellation', async () => {
    let deleted = false;
    let finishGeneration!: (analysis: Record<string, unknown>) => void;
    const foreignKeyError = Object.assign(
      new Error('FOREIGN KEY constraint failed'),
      { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' },
    );
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () =>
          deleted
            ? null
            : {
                id: 'deleted-during-generation',
                transcript_json: JSON.stringify({
                  segments: [{ speaker: 1, text: 'Delete this meeting.' }],
                }),
                transcript_status: 'validated',
                transcript_integrity_json: JSON.stringify({ verified: true }),
                user_notes: '',
              },
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'deleted-source',
          eligibilityRevision: 'deleted-eligibility',
          userNotesHash: 'deleted-notes',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn(),
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn().mockReturnValue(true),
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
        getAllEntities: () => [],
        upsertMeetingAnalysisRunMetric: vi.fn(() => {
          throw foreignKeyError;
        }),
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: () =>
          new Promise((resolve) => {
            finishGeneration = resolve;
          }),
      }),
      createRunId: () => 'deleted-run',
    });
    const generation = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'deleted-during-generation',
      requestId: 'deleted-request',
      template: 'auto',
      reason: 'manual',
    });

    await vi.waitFor(() => expect(finishGeneration).toBeTypeOf('function'));
    expect(coordinator.supersedeMeetingNotes('deleted-during-generation')).toBe(
      true,
    );
    deleted = true;
    finishGeneration({
      analysis_schema_version: 3,
      overview: 'Stale notes.',
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
  });

  it('keeps durable publication when metrics and publication notification fail', async () => {
    const onPublished = vi.fn(() => {
      throw new Error('notification unavailable');
    });
    const publishMeetingNotesIfCurrent = vi.fn().mockReturnValue(true);
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'metric-write-failure',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: 'Publish these notes.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'metric-failure-source',
          eligibilityRevision: 'metric-failure-eligibility',
          userNotesHash: 'metric-failure-notes',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn(),
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn().mockReturnValue(true),
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent,
        getAllEntities: () => [],
        upsertMeetingAnalysisRunMetric: vi.fn(() => {
          throw new Error('metrics unavailable');
        }),
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: vi.fn().mockResolvedValue({
          analysis_schema_version: 3,
          overview: 'Published notes.',
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
      createRunId: () => 'metric-write-failure-run',
      onPublished,
    });

    await expect(
      coordinator.generateAndPublishMeetingNotes({
        meetingId: 'metric-write-failure',
        requestId: 'metric-write-failure-request',
        template: 'auto',
        reason: 'manual',
      }),
    ).resolves.toMatchObject({ status: 'published' });
    expect(publishMeetingNotesIfCurrent).toHaveBeenCalledTimes(1);
    expect(onPublished).toHaveBeenCalledWith(
      'metric-write-failure',
      'metric-write-failure-run',
    );
  });

  it('announces publication only after notes are durably published', async () => {
    const onUpdated = vi.fn();
    const onPublished = vi.fn();
    let finishGeneration!: (analysis: {
      analysis_schema_version: number;
      overview: string;
      topics: never[];
      all_action_items: never[];
      all_decisions: never[];
      meeting_type: string;
      quality: {
        format_pass: boolean;
        retry_count: number;
        fallback_used: boolean;
        issues: never[];
      };
    }) => void;
    const generateStructuredAnalysis = vi.fn(
      () =>
        new Promise<Parameters<typeof finishGeneration>[0]>((resolve) => {
          finishGeneration = resolve;
        }),
    );
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'publish-boundary',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: 'We agreed to ship.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'publish-source',
          eligibilityRevision: 'publish-eligibility',
          userNotesHash: 'publish-notes',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn().mockReturnValue(true),
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn().mockReturnValue(true),
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis,
      }),
      createRunId: () => 'publish-run',
      onUpdated,
      onPublished,
    });

    const publication = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'publish-boundary',
      requestId: 'publish-request',
      template: 'auto',
      reason: 'manual',
    });
    await vi.waitFor(() =>
      expect(generateStructuredAnalysis).toHaveBeenCalled(),
    );

    expect(onUpdated).toHaveBeenCalled();
    expect(onPublished).not.toHaveBeenCalled();

    finishGeneration({
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
    await publication;

    expect(onPublished).toHaveBeenCalledTimes(1);
    expect(onPublished).toHaveBeenCalledWith('publish-boundary', 'publish-run');
  });

  it('aborts an admitted notes run at the absolute deadline with an exact failure code', async () => {
    const updateMeetingAnalysisRunStatus = vi.fn().mockReturnValue(true);
    const generateStructuredAnalysis = vi.fn(
      async () => new Promise<never>(() => undefined),
    );
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'deadline-run',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: 'A complete transcript.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'deadline-source',
          eligibilityRevision: 'deadline-eligibility',
          userNotesHash: 'deadline-notes',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus,
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn().mockReturnValue(true),
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({ name: 'ollama', generateStructuredAnalysis }),
      createRunId: () => 'deadline-run-id',
      notesDeadlineMs: 10,
    });

    await expect(
      coordinator.generateAndPublishMeetingNotes({
        meetingId: 'deadline-run',
        requestId: 'deadline-request',
        template: 'auto',
        reason: 'manual',
      }),
    ).rejects.toThrow('notes_deadline_exceeded');
    expect(updateMeetingAnalysisRunStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        notesStatus: 'failed',
        stage: 'notes_failed',
        errorCode: 'notes_deadline_exceeded',
      }),
    );
  }, 500);

  it('stops automatic retries after two failures for the same fingerprint while allowing manual retry', async () => {
    const generateStructuredAnalysis = vi.fn().mockResolvedValue({
      analysis_schema_version: 3,
      overview: 'Manually recovered notes.',
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
    const revisions = {
      sourceRevision: 'attempt-source',
      eligibilityRevision: 'attempt-eligibility',
      userNotesHash: 'attempt-notes',
    };
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          ...revisions,
          terms: [],
          template: autoTemplateIdentity,
          provider: 'ollama',
          model: 'gemma4:12b',
          thinking: null,
          seed: null,
          contextTokens: 16384,
          promptVersion: 'notes-v33',
        }),
        'utf8',
      )
      .digest('hex');
    let persistedInputRevision = fingerprint;
    const beginMeetingAnalysisRun = vi.fn();
    const db = {
      getMeeting: () => ({
        id: 'attempt-cap',
        transcript_json: JSON.stringify({
          segments: [{ speaker: 1, text: 'Stable transcript.' }],
        }),
        transcript_status: 'validated',
        transcript_integrity_json: JSON.stringify({ verified: true }),
        user_notes: '',
      }),
      getMeetingAnalysisPublicationRevisions: () => revisions,
      getMeetingAnalysisRun: () => ({
        run_id: 'failed-run',
        input_revision: persistedInputRevision,
        notes_status: 'failed',
        secondary_status: 'pending',
        automatic_attempt_count: 2,
      }),
      beginMeetingAnalysisRun,
      updateMeetingAnalysisRunStatus: vi.fn().mockReturnValue(true),
      updateMeetingAnalysisRunStatusIfCurrent: vi.fn().mockReturnValue(true),
      isMeetingAnalysisRunCurrent: () => true,
      publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
      getAllEntities: () => [],
    };
    const coordinator = createMeetingAnalysisRunCoordinator({
      db,
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({ name: 'ollama', generateStructuredAnalysis }),
      createRunId: () => 'retry-run',
    });

    await expect(
      coordinator.generateAndPublishMeetingNotes({
        meetingId: 'attempt-cap',
        requestId: 'automatic-request',
        template: 'auto',
        reason: 'automatic',
      }),
    ).rejects.toThrow('meeting_notes_automatic_attempts_exhausted');
    expect(beginMeetingAnalysisRun).not.toHaveBeenCalled();
    expect(generateStructuredAnalysis).not.toHaveBeenCalled();

    persistedInputRevision = 'changed-input';
    await expect(
      coordinator.generateAndPublishMeetingNotes({
        meetingId: 'attempt-cap',
        requestId: 'changed-automatic-request',
        template: 'auto',
        reason: 'automatic',
      }),
    ).resolves.toMatchObject({ status: 'published' });
    expect(beginMeetingAnalysisRun).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'automatic' }),
    );

    await expect(
      coordinator.generateAndPublishMeetingNotes({
        meetingId: 'attempt-cap',
        requestId: 'manual-request',
        template: 'auto',
        reason: 'manual',
      }),
    ).resolves.toMatchObject({ status: 'published' });
    expect(beginMeetingAnalysisRun).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'manual' }),
    );
  });

  it('records the stable terminal failure code in content-free run metrics', async () => {
    const upsertMeetingAnalysisRunMetric = vi.fn();
    const onPublished = vi.fn();
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'failed-metric',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: 'Stable transcript.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'failed-source',
          eligibilityRevision: 'failed-eligibility',
          userNotesHash: 'failed-notes',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn().mockReturnValue(true),
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn().mockReturnValue(true),
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
        getAllEntities: () => [],
        upsertMeetingAnalysisRunMetric,
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: vi
          .fn()
          .mockRejectedValue(new Error('notes_context_exhausted')),
      }),
      createRunId: () => 'failed-metric-run',
      onPublished,
    });

    await expect(
      coordinator.generateAndPublishMeetingNotes({
        meetingId: 'failed-metric',
        requestId: 'failed-metric-request',
        template: 'auto',
        reason: 'automatic',
      }),
    ).rejects.toThrow('notes_context_exhausted');
    expect(upsertMeetingAnalysisRunMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'notes_context_exhausted',
      }),
    );
    expect(onPublished).not.toHaveBeenCalled();
  });

  it.each([
    [
      'residency discovery',
      new Error('ollama_residency_discovery_failed'),
      'failed',
      'ollama_residency_discovery_failed',
    ],
    [
      'residency cleanup',
      new Error('ollama_residency_cleanup_failed'),
      'failed',
      'ollama_residency_cleanup_failed',
    ],
    [
      'unknown provider',
      new Error('unrelated_provider_failure'),
      'failed',
      'notes_generation_failed',
    ],
    [
      'caller cancellation',
      new DOMException('cancelled', 'AbortError'),
      'cancelled',
      'notes_cancelled',
    ],
  ] as const)(
    'persists the exact %s terminal code',
    async (_case, providerError, expectedStatus, expectedCode) => {
      const updateMeetingAnalysisRunStatus = vi.fn().mockReturnValue(true);
      const upsertMeetingAnalysisRunMetric = vi.fn();
      const coordinator = createMeetingAnalysisRunCoordinator({
        db: {
          getMeeting: () => ({
            id: 'provider-failure',
            transcript_json: JSON.stringify({
              segments: [{ speaker: 1, text: 'Stable transcript.' }],
            }),
            transcript_status: 'validated',
            transcript_integrity_json: JSON.stringify({ verified: true }),
            user_notes: '',
          }),
          getMeetingAnalysisPublicationRevisions: () => ({
            sourceRevision: 'provider-failure-source',
            eligibilityRevision: 'provider-failure-eligibility',
            userNotesHash: 'provider-failure-notes',
          }),
          getMeetingAnalysisRun: () => null,
          beginMeetingAnalysisRun: vi.fn(),
          updateMeetingAnalysisRunStatus,
          updateMeetingAnalysisRunStatusIfCurrent: vi
            .fn()
            .mockReturnValue(true),
          isMeetingAnalysisRunCurrent: () => true,
          publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
          getAllEntities: () => [],
          upsertMeetingAnalysisRunMetric,
        },
        getSettings: async () => ({ llm_provider: 'ollama' }),
        getProvider: async () => ({
          name: 'ollama',
          generateStructuredAnalysis: vi.fn().mockRejectedValue(providerError),
        }),
        createRunId: () => 'provider-failure-run',
      });

      await expect(
        coordinator.generateAndPublishMeetingNotes({
          meetingId: 'provider-failure',
          requestId: 'provider-failure-request',
          template: 'auto',
          reason: 'manual',
        }),
      ).rejects.toBe(providerError);
      expect(updateMeetingAnalysisRunStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          notesStatus: expectedStatus,
          errorCode: expectedCode,
        }),
      );
      expect(upsertMeetingAnalysisRunMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expectedStatus,
          errorCode: expectedCode,
        }),
      );
    },
  );

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
          compactWriterContract: true,
          knownTerms: ['Ogletree'],
          hierarchyAuditStrategy: 'deterministic_only',
          trustedUserTerms: [],
          entityHints: ['Ogletree'],
          workClass: 'manual_notes',
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
            template: autoTemplateIdentity,
            provider: 'ollama',
            model: 'gemma4:12b',
            thinking: null,
            seed: null,
            contextTokens: 16384,
            promptVersion: 'notes-v33',
          }),
          'utf8',
        )
        .digest('hex');
      expect(beginMeetingAnalysisRun).toHaveBeenCalledWith(
        expect.objectContaining({ inputRevision: fingerprint }),
      );
      const stageCacheKey = createHash('sha256')
        .update(
          JSON.stringify({
            userNotesHash: 'notes-terms',
            terms: ['Ogletree'],
            template: autoTemplateIdentity,
            provider: 'ollama',
            model: 'gemma4:12b',
            thinking: null,
            seed: null,
            contextTokens: 16384,
            promptVersion: 'notes-v33',
          }),
          'utf8',
        )
        .digest('hex');
      expect(generateStructuredAnalysis.mock.calls[0]?.[3].cacheKey).toBe(
        stageCacheKey,
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
    const onPublished = vi.fn();
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
      onPublished,
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
    expect(onPublished).toHaveBeenCalledTimes(1);
    expect(onPublished).toHaveBeenCalledWith('meeting-a', 'run-a');
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

  it('does not announce publication after every subscriber cancels an in-flight run', async () => {
    const onPublished = vi.fn();
    const knowledgePause = { acquire: vi.fn(), release: vi.fn() };
    const generateStructuredAnalysis = vi.fn(
      (
        _transcript: string,
        _notes: string,
        _template: string,
        options?: { signal?: AbortSignal },
      ) =>
        new Promise<never>((_resolve, reject) => {
          const signal = options?.signal;
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'cancelled-run',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: 'Do not publish these notes.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'cancelled-source',
          eligibilityRevision: 'cancelled-eligibility',
          userNotesHash: 'cancelled-notes',
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
      createRunId: () => 'cancelled-run-id',
      knowledgeSynthesisPause: knowledgePause,
      onPublished,
    });
    const generation = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'cancelled-run',
      requestId: 'cancelled-request',
      template: 'auto',
      reason: 'manual',
    });

    await vi.waitFor(() =>
      expect(generateStructuredAnalysis).toHaveBeenCalledTimes(1),
    );
    await expect(
      coordinator.cancelMeetingNotes({
        meetingId: 'cancelled-run',
        requestId: 'cancelled-request',
      }),
    ).resolves.toEqual({ cancelled: true });
    await expect(generation).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() =>
      expect(knowledgePause.release).toHaveBeenCalledWith('meeting_notes_run'),
    );

    expect(onPublished).not.toHaveBeenCalled();
  });

  it('prevents an active run from publishing after notes restoration supersedes it', async () => {
    let resolveGeneration: ((value: Record<string, unknown>) => void) | null =
      null;
    const publishMeetingNotesIfCurrent = vi.fn().mockReturnValue(true);
    const onPublished = vi.fn();
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
      onPublished,
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
    expect(onPublished).not.toHaveBeenCalled();
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

  it('runs one primary meeting at a time and admits queued manuals before automatics', async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const beginMeetingAnalysisRun = vi.fn();
    const updateMeetingAnalysisQueuePosition = vi.fn().mockReturnValue(true);
    let runSequence = 0;
    const analysis = {
      analysis_schema_version: 3 as const,
      overview: 'Reviewed notes.',
      topics: [],
      all_action_items: [],
      all_decisions: [],
      meeting_type: 'general' as const,
      quality: {
        format_pass: true,
        retry_count: 0,
        fallback_used: false,
        issues: [],
      },
    };
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: (meetingId) => ({
          id: meetingId,
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: `meeting-${meetingId}` }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          user_notes: '',
        }),
        getMeetingAnalysisPublicationRevisions: (meeting) => ({
          sourceRevision: `source-${meeting.id}`,
          eligibilityRevision: `eligible-${meeting.id}`,
          userNotesHash: `notes-${meeting.id}`,
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun,
        updateMeetingAnalysisQueuePosition,
        updateMeetingAnalysisRunStatus: vi.fn().mockReturnValue(true),
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn().mockReturnValue(true),
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis: async (transcript: string) => {
          const meetingId = transcript.match(/meeting-(one|two|three)/)?.[1]!;
          order.push(meetingId);
          if (meetingId === 'one') await first;
          return analysis;
        },
      }),
      createRunId: () => `run-${++runSequence}`,
    });

    const one = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'one',
      requestId: 'request-one',
      template: 'auto',
      reason: 'automatic',
    });
    const two = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'two',
      requestId: 'request-two',
      template: 'auto',
      reason: 'automatic',
    });
    const three = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'three',
      requestId: 'request-three',
      template: 'auto',
      reason: 'manual',
    });

    await vi.waitFor(() => expect(order).toEqual(['one']));
    expect(beginMeetingAnalysisRun).toHaveBeenCalledTimes(3);
    expect(beginMeetingAnalysisRun).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'queued', queuePosition: null }),
    );
    expect(updateMeetingAnalysisQueuePosition).toHaveBeenCalledWith({
      meetingId: 'three',
      runId: 'run-3',
      queuePosition: 1,
    });
    releaseFirst();

    await Promise.all([one, two, three]);
    expect(order).toEqual(['one', 'three', 'two']);
  });

  it('revalidates publication revisions after admission and before the first model call', async () => {
    let reads = 0;
    const generateStructuredAnalysis = vi.fn();
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => {
          reads += 1;
          return {
            id: 'revalidate',
            transcript_json: JSON.stringify({
              segments: [{ speaker: 1, text: 'Stable transcript.' }],
            }),
            transcript_status: 'validated',
            transcript_integrity_json: JSON.stringify({ verified: true }),
            user_notes: reads >= 3 ? 'changed' : '',
          };
        },
        getMeetingAnalysisPublicationRevisions: (meeting) => ({
          sourceRevision: 'source-revalidate',
          eligibilityRevision: 'eligible-revalidate',
          userNotesHash: meeting.user_notes
            ? 'changed-notes'
            : 'original-notes',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn().mockReturnValue(true),
        updateMeetingAnalysisRunStatusIfCurrent: vi.fn().mockReturnValue(true),
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: vi.fn().mockReturnValue(true),
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({ name: 'ollama', generateStructuredAnalysis }),
      createRunId: () => 'run-revalidate',
    });

    await expect(
      coordinator.generateAndPublishMeetingNotes({
        meetingId: 'revalidate',
        requestId: 'request-revalidate',
        template: 'auto',
        reason: 'manual',
      }),
    ).rejects.toThrow('meeting_notes_superseded');
    expect(generateStructuredAnalysis).not.toHaveBeenCalled();
  });

  it('executes secondary work for published notes without regenerating primary notes', async () => {
    const updateSecondaryStatus = vi.fn();
    const generateStructuredAnalysis = vi.fn();
    const runSecondary = vi.fn().mockResolvedValue(undefined);
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'meeting-secondary-only',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 'Me', text: 'I will finish the report.' }],
          }),
          transcript_status: 'validated',
          transcript_integrity_json: JSON.stringify({ verified: true }),
          transcript_validated_at: '2026-09-14T00:00:00.000Z',
          user_notes: '',
          analysis_json: JSON.stringify({
            analysis_schema_version: 3,
            overview: 'Discussed project commitments.',
            topics: [],
            all_action_items: [
              {
                text: 'Finish the report',
                assignee: 'Me',
                due: 'tomorrow',
              },
            ],
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
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'source-sec',
          eligibilityRevision: 'eligible-sec',
          userNotesHash: 'notes-sec',
        }),
        getMeetingAnalysisRun: () => ({
          run_id: 'run-sec',
          input_revision: 'revision-sec',
          notes_status: 'published',
          secondary_status: 'failed',
        }),
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: vi.fn(),
        updateMeetingAnalysisRunStatusIfCurrent: updateSecondaryStatus,
        isMeetingAnalysisRunCurrent: () => true,
        publishMeetingNotesIfCurrent: vi.fn(),
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider: async () => ({
        name: 'ollama',
        generateStructuredAnalysis,
      }),
      runSecondary,
    });

    const result = await coordinator.generateAndPublishMeetingNotes({
      meetingId: 'meeting-secondary-only',
      requestId: 'request-sec',
      template: 'auto',
      reason: 'secondary',
    });

    expect(result).toEqual({
      meetingId: 'meeting-secondary-only',
      runId: 'run-sec',
      status: 'published',
    });
    expect(generateStructuredAnalysis).not.toHaveBeenCalled();
    expect(runSecondary).toHaveBeenCalledTimes(1);
    expect(updateSecondaryStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        secondaryStatus: 'complete',
        stage: 'complete',
      }),
    );
  });
});
