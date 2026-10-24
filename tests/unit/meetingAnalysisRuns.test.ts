import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { getDownstreamProcessingPresentation } from '../../src/components/features/downstreamProcessingPresentation';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';

import type { NotesStageEvent } from '../../electron/llm/meetingNotesRunMetrics';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import {
  createMeetingNotesTemplateSettingsSnapshot,
  resolveMeetingNotesTemplate,
} from '../../electron/llm/meetingNotesTemplates';
import { NOTES_PROMPT_VERSION } from '../../electron/llm/meetingNotesTypes';
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
  it.each([undefined, 'ollama', 'chatgpt'])(
    'keeps draft previews in memory and applies the production writer policy (%s)',
    async (providerName) => {
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
        getSettings: async () => ({ llm_provider: providerName }),
        createRunId: () => 'preview-run',
        getProvider: async () => ({
          name: providerName || 'ollama',
          generateStructuredAnalysis: async (
            transcript,
            _notes,
            _template,
            options,
          ) => {
            expect(transcript).toBe('Alex: We agreed to ship.');
            expect(options?.source?.segments[0]?.speaker).toBe('Alex');
            expect(options?.trustedUserTerms).toEqual(['Alex']);
            expect(options?.compactWriterContract).toBe(true);
            expect(options?.hierarchyAuditStrategy).toBe(
              providerName === 'chatgpt' ? undefined : 'deterministic_only',
            );
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
    },
  );

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

  it('refuses an in-flight local approval when speaker identity trust changes mid-generation', async () => {
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

    await expect(
      coordinator.generateAndPublishMeetingNotes({
        meetingId: 'parallel-meeting',
        requestId: 'parallel-request',
        template: 'auto',
        reason: 'automatic',
      }),
    ).rejects.toThrow('meeting_notes_superseded');
    expect(publish).not.toHaveBeenCalled();
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
    expect(shouldUseMeetingNotesOptionalReviewBudget('ChatGPT')).toBe(true);
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

  it('does not precompute paid cloud leaves while the transcript is changing', async () => {
    const getProvider = vi.fn();
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {} as never,
      getSettings: async () => ({ llm_provider: 'chatgpt' }),
      getProvider,
    });
    await expect(
      coordinator.precomputeIncrementalMeetingNotes({
        source: createNotesSource(
          JSON.stringify({
            segments: [{ speaker: 'Alex', text: 'A partial meeting.' }],
          }),
        ),
        userNotes: '',
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('discarded');
    expect(getProvider).not.toHaveBeenCalled();
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
          provider: 'Ollama (Local)',
          model: 'gemma4:12b',
          thinking: null,
          seed: null,
          contextTokens: 16384,
          promptVersion: NOTES_PROMPT_VERSION,
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
      'memory capacity',
      Object.assign(new Error('private capacity detail'), {
        name: 'LocalModelMemoryError',
      }),
      'failed',
      'notes_memory_capacity',
    ],
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
          trustedUserTerms: [],
          entityHints: ['Ogletree'],
          workClass: 'manual_notes',
        }),
      );
      expect(generateStructuredAnalysis.mock.calls[0]?.[3]).toHaveProperty(
        'hierarchyAuditStrategy',
        'deterministic_only',
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
            provider: 'Ollama (Local)',
            model: 'gemma4:12b',
            thinking: null,
            seed: null,
            contextTokens: 16384,
            promptVersion: NOTES_PROMPT_VERSION,
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
            provider: 'Ollama (Local)',
            model: 'gemma4:12b',
            thinking: null,
            seed: null,
            contextTokens: 16384,
            promptVersion: NOTES_PROMPT_VERSION,
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

  it.each([
    [
      'value_signals_failed',
      'failed',
      'secondary_failed',
      'value_signals_failed',
    ],
    [
      'knowledge_document_refresh_incomplete',
      'failed',
      'secondary_failed',
      'knowledge_document_refresh_incomplete',
    ],
    ['knowledge_document_refresh_deferred', 'pending', 'knowledge', null],
  ])(
    'keeps published notes when secondary work returns %s',
    async (error, status, stage, code) => {
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
          throw new Error(error!);
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
            secondaryStatus: status,
            stage,
            errorCode: code,
          }),
        );
      });
      expect(publishMeetingNotesIfCurrent).toHaveBeenCalledTimes(1);
    },
  );

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

describe('published notes do not regenerate from secondary vocabulary', () => {
  const setup = (
    secondaryStatus = 'complete',
    provider: 'chatgpt' | 'ollama' = 'chatgpt',
  ) => {
    const template = resolveMeetingNotesTemplate(
      createMeetingNotesTemplateSettingsSnapshot('auto', {}),
      'auto',
    );
    const settings = {
      llm_provider: provider,
      ollama_model: 'gemma4:12b',
      chatgpt_model: 'gpt-5.6-terra',
    };
    const revisions = {
      sourceRevision: 'saved-source',
      eligibilityRevision: 'eligible',
      userNotesHash: 'scratchpad',
    };
    const run = {
      run_id: 'saved-run',
      input_revision: 'legacy-fingerprint-before-extraction',
      source_revision: revisions.sourceRevision,
      eligibility_revision: revisions.eligibilityRevision,
      user_notes_hash: revisions.userNotesHash,
      notes_status: 'published',
      secondary_status: secondaryStatus,
    };
    const meeting = {
      id: 'fictional-saved',
      transcript_status: 'validated',
      transcript_json: JSON.stringify({
        segments: [
          { speaker: 'Them', text: 'Riley will send the checklist by Monday.' },
        ],
      }),
      analysis_json: JSON.stringify({
        analysis_schema_version: 3,
        overview: 'Pilot readiness',
        topics: [],
        all_decisions: [],
        all_action_items: [
          { text: 'Send the checklist', assignee: 'Riley', due: 'Monday' },
        ],
        meeting_type: 'general',
        quality: {
          format_pass: true,
          retry_count: 0,
          fallback_used: false,
          issues: [],
        },
        generation_metadata: {
          provider,
          model:
            provider === 'ollama'
              ? settings.ollama_model
              : settings.chatgpt_model,
          prompt_version: NOTES_PROMPT_VERSION,
          notes_template: template,
        },
      }),
    };
    const projection = {
      speakerDisplayNames: {} as Record<string, string>,
      trustedUserTerms: [] as string[],
    };
    const writer = vi.fn().mockRejectedValue(new Error('writer_called'));
    const begin = vi.fn();
    const current = vi.fn(
      ({ inputRevision }) =>
        begin.mock.calls.length > 0 || inputRevision === run.input_revision,
    );
    const secondary = vi.fn(async ({ canCommit }) => {
      expect(canCommit()).toBe(true);
    });
    const getProvider = vi.fn(async () => ({
      name: provider,
      generateStructuredAnalysis: writer,
    }));
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => meeting,
        getMeetingNotesIdentityProjection: () => projection,
        getMeetingAnalysisPublicationRevisions: () => revisions,
        getMeetingAnalysisRun: () => run,
        beginMeetingAnalysisRun: begin,
        updateMeetingAnalysisRunStatus: () => true,
        updateMeetingAnalysisRunStatusIfCurrent: ({ secondaryStatus }) => {
          if (secondaryStatus) run.secondary_status = secondaryStatus;
          return true;
        },
        isMeetingAnalysisRunCurrent: current,
        publishMeetingNotesIfCurrent: vi.fn(),
        getAllEntities: () => [
          { type: 'person', name: 'Riley' },
          { type: 'person', name: 'Avery' },
          { type: 'project', name: 'Harbor pilot' },
        ],
      },
      getSettings: async () => settings,
      getProvider,
      runSecondary: secondary,
    });
    return {
      coordinator,
      projection,
      getProvider,
      settings,
      revisions,
      run,
      meeting,
      writer,
      begin,
      secondary,
      current,
    };
  };
  const request = {
    meetingId: 'fictional-saved',
    requestId: 'offline',
    reason: 'automatic' as const,
  };

  it('does not reuse a local approval when an identical speaker label becomes explicitly confirmed', async () => {
    const f = setup('complete', 'ollama');
    await expect(
      f.coordinator.generateAndPublishMeetingNotes(request),
    ).resolves.toMatchObject({ status: 'published' });
    f.projection.speakerDisplayNames = { Them: 'Them' };
    await expect(
      f.coordinator.generateAndPublishMeetingNotes({
        ...request,
        requestId: 'confirmed',
      }),
    ).rejects.toThrow('writer_called');
    expect(f.writer).toHaveBeenCalledTimes(1);
  });
  it('reuses the same nonempty confirmed mapping independently of insertion order', async () => {
    const f = setup('complete', 'ollama');
    f.projection.speakerDisplayNames = {
      'Remote Speaker 2': 'Briar',
      'Remote Speaker 1': 'Ellis',
    };
    const identityRevision = createHash('sha256')
      .update(
        JSON.stringify([
          ['Remote Speaker 1', 'Ellis'],
          ['Remote Speaker 2', 'Briar'],
        ]),
        'utf8',
      )
      .digest('hex');
    const analysis = JSON.parse(f.meeting.analysis_json);
    analysis.generation_metadata.generation_options = {
      speaker_identity_revision: identityRevision,
    };
    f.meeting.analysis_json = JSON.stringify(analysis);
    await f.coordinator.generateAndPublishMeetingNotes(request);
    f.projection.speakerDisplayNames = {
      'Remote Speaker 1': 'Ellis',
      'Remote Speaker 2': 'Briar',
    };
    await f.coordinator.generateAndPublishMeetingNotes({
      ...request,
      requestId: 'same-trust',
    });
    expect(f.writer).not.toHaveBeenCalled();
  });

  it('keeps an unchanged empty identity projection reusable for local notes', async () => {
    const f = setup('complete', 'ollama');
    await f.coordinator.generateAndPublishMeetingNotes(request);
    await f.coordinator.generateAndPublishMeetingNotes({
      ...request,
      requestId: 'unchanged',
    });
    expect(f.writer).not.toHaveBeenCalled();
  });

  it('reuses an existing published run despite names added by secondary extraction', async () => {
    const f = setup();
    f.getProvider.mockRejectedValue(new Error('chatgpt_sign_in_required'));
    expect(
      await f.coordinator.generateAndPublishMeetingNotes(request),
    ).toMatchObject({ runId: 'saved-run', status: 'published' });
    expect(f.writer).not.toHaveBeenCalled();
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.secondary).not.toHaveBeenCalled();
    expect(f.getProvider).not.toHaveBeenCalled();
  });

  it('preserves published notes when resuming secondary work cannot initialize the provider', async () => {
    const f = setup('pending');
    f.getProvider.mockRejectedValue(new Error('chatgpt_sign_in_required'));
    await expect(
      f.coordinator.generateAndPublishMeetingNotes(request),
    ).resolves.toMatchObject({ status: 'published' });
    await vi.waitFor(() => expect(f.getProvider).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(f.run.secondary_status).toBe('failed'));
    expect(f.run.notes_status).toBe('published');
    expect(f.writer).not.toHaveBeenCalled();
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.secondary).not.toHaveBeenCalled();
  });

  it('resumes missing secondary work with the saved revision, then reuses it', async () => {
    const f = setup('failed');
    await f.coordinator.generateAndPublishMeetingNotes(request);
    await vi.waitFor(() => expect(f.run.secondary_status).toBe('complete'));
    await f.coordinator.generateAndPublishMeetingNotes({
      ...request,
      requestId: 'again',
    });
    expect(f.secondary).toHaveBeenCalledTimes(1);
    expect(f.writer).not.toHaveBeenCalled();
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.current).toHaveBeenCalledWith(
      expect.objectContaining({
        inputRevision: 'legacy-fingerprint-before-extraction',
      }),
    );
  });

  it('retries deferred knowledge work without regenerating published notes', async () => {
    const f = setup('pending');
    const revision = f.run.input_revision;
    f.secondary.mockRejectedValueOnce(
      new Error('knowledge_document_refresh_deferred'),
    );
    await f.coordinator.generateAndPublishMeetingNotes(request);
    await vi.waitFor(() => expect(f.secondary).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(f.run.secondary_status).toBe('pending'));
    await f.coordinator.generateAndPublishMeetingNotes({
      ...request,
      requestId: 'deferred-retry',
      reason: 'secondary',
    });
    await vi.waitFor(() => expect(f.run.secondary_status).toBe('complete'));
    expect(f.secondary).toHaveBeenCalledTimes(2);
    expect(f.run.input_revision).toBe(revision);
    expect(f.run.notes_status).toBe('published');
    expect(f.writer).not.toHaveBeenCalled();
    expect(f.begin).not.toHaveBeenCalled();
  });

  it.each(['provider', 'model', 'template', 'prompt', 'seed', 'thinking'])(
    'keeps published cloud notes through changed %s without paying for writers or backfill',
    async (change) => {
      const f = setup('failed');
      const analysis = JSON.parse(f.meeting.analysis_json);
      if (change === 'provider')
        analysis.generation_metadata.provider = 'ollama';
      if (change === 'model') f.settings.chatgpt_model = 'gpt-6.1-sol';
      if (change === 'template')
        analysis.generation_metadata.notes_template.revision = 'old';
      if (change === 'prompt')
        analysis.generation_metadata.prompt_version = 'old';
      if (change === 'seed')
        analysis.generation_metadata.generation_options = { seed: 42 };
      if (change === 'thinking')
        analysis.generation_metadata.generation_options = {
          structured_thinking: true,
        };
      f.meeting.analysis_json = JSON.stringify(analysis);
      await expect(
        f.coordinator.generateAndPublishMeetingNotes(request),
      ).resolves.toMatchObject({ runId: 'saved-run', status: 'published' });
      expect(f.writer).not.toHaveBeenCalled();
      expect(f.secondary).not.toHaveBeenCalled();
      expect(f.begin).not.toHaveBeenCalled();
    },
  );

  it('does not silently reuse malformed published cloud notes', async () => {
    const f = setup();
    f.meeting.analysis_json = '{broken';
    await expect(
      f.coordinator.generateAndPublishMeetingNotes(request),
    ).rejects.toThrow('writer_called');
    expect(f.writer).toHaveBeenCalledTimes(1);
  });

  it('applies a changed cloud model when the user explicitly regenerates', async () => {
    const f = setup();
    f.settings.chatgpt_model = 'gpt-6.1-sol';
    await expect(
      f.coordinator.generateAndPublishMeetingNotes({
        ...request,
        reason: 'manual',
      }),
    ).rejects.toThrow('writer_called');
    expect(f.writer).toHaveBeenCalledTimes(1);
  });

  it.each(['model', 'prompt'])(
    'preserves Ollama automatic rewrites for changed %s',
    async (change) => {
      const f = setup('complete', 'ollama');
      if (change === 'model') f.settings.ollama_model = 'another-local-model';
      else {
        const analysis = JSON.parse(f.meeting.analysis_json);
        analysis.generation_metadata.prompt_version = 'old';
        f.meeting.analysis_json = JSON.stringify(analysis);
      }
      await expect(
        f.coordinator.generateAndPublishMeetingNotes(request),
      ).rejects.toThrow('writer_called');
      expect(f.writer).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['source', 'scratchpad', 'eligibility', 'manual'])(
    'still generates for changed %s',
    async (change) => {
      const f = setup();
      if (change === 'source') f.revisions.sourceRevision = 'changed';
      if (change === 'scratchpad') f.revisions.userNotesHash = 'changed';
      if (change === 'eligibility') f.revisions.eligibilityRevision = 'changed';
      if (change === 'model') f.settings.chatgpt_model = 'gpt-6.1-sol';
      if (['template', 'prompt', 'seed', 'thinking'].includes(change)) {
        const a = JSON.parse(f.meeting.analysis_json);
        if (change === 'template')
          a.generation_metadata.notes_template.revision = 'changed';
        if (change === 'prompt') a.generation_metadata.prompt_version = 'old';
        if (change === 'seed')
          a.generation_metadata.generation_options = { seed: 42 };
        if (change === 'thinking')
          a.generation_metadata.generation_options = {
            structured_thinking: true,
          };
        f.meeting.analysis_json = JSON.stringify(a);
      }
      await expect(
        f.coordinator.generateAndPublishMeetingNotes({
          ...request,
          reason: change === 'manual' ? 'manual' : 'automatic',
        }),
      ).rejects.toThrow('writer_called');
      expect(f.writer).toHaveBeenCalledTimes(1);
    },
  );
});

describe('provider startup failures are durable notes failures', () => {
  it.each([
    [
      'chatgpt',
      new Error('chatgpt_sign_in_required'),
      'chatgpt_sign_in_required',
    ],
    [
      'ollama',
      Object.assign(new Error('Local service unavailable'), {
        code: 'provider_unavailable',
      }),
      'provider_unavailable',
    ],
    [
      'chatgpt',
      new Error('chatgpt_cloud_consent_required'),
      'chatgpt_cloud_consent_required',
    ],
    ['chatgpt', new Error('chatgpt_model_required'), 'chatgpt_model_required'],
  ] as const)(
    'persists %s initialization failure and bounds automatic attempts',
    async (provider, failure, code) => {
      const meeting = {
        id: 'startup-failure',
        transcript_status: 'validated',
        transcript_json: JSON.stringify({
          segments: [{ speaker: 1, text: 'A fictional meeting.' }],
        }),
      };
      const revisions = {
        sourceRevision: 'source',
        eligibilityRevision: 'eligible',
        userNotesHash: 'notes',
      };
      let run: {
        run_id: string;
        input_revision: string;
        notes_status: string;
        automatic_attempt_count: number;
        error_code?: string | null;
      } | null = null;
      const publish = vi.fn();
      const getProvider = vi.fn(async () => {
        expect(run?.notes_status).toBe('running');
        throw failure;
      });
      const onUpdated = vi.fn();
      const coordinator = createMeetingAnalysisRunCoordinator({
        db: {
          getMeeting: () => meeting,
          getMeetingAnalysisPublicationRevisions: () => revisions,
          getMeetingAnalysisRun: () => run,
          beginMeetingAnalysisRun: (input) => {
            run = {
              run_id: input.runId,
              input_revision: input.inputRevision,
              notes_status: 'running',
              automatic_attempt_count: (run?.automatic_attempt_count ?? 0) + 1,
            };
          },
          updateMeetingAnalysisRunStatus: (input) => {
            if (!run) throw new Error('missing_run');
            run.notes_status = input.notesStatus;
            run.error_code = input.errorCode;
            return true;
          },
          updateMeetingAnalysisRunStatusIfCurrent: () => true,
          isMeetingAnalysisRunCurrent: () => true,
          publishMeetingNotesIfCurrent: publish,
          getAllEntities: () => [],
        },
        getSettings: async () => ({ llm_provider: provider }),
        getProvider,
        onUpdated,
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          coordinator.generateAndPublishMeetingNotes({
            meetingId: meeting.id,
            requestId: `attempt-${attempt}`,
            reason: 'automatic',
          }),
        ).rejects.toBe(failure);
        expect(
          getDownstreamProcessingPresentation({
            ...meeting,
            analysis_run_json: JSON.stringify(run),
          }),
        ).toMatchObject({ state: 'failed', failureCode: code });
      }
      await expect(
        coordinator.generateAndPublishMeetingNotes({
          meetingId: meeting.id,
          requestId: 'exhausted',
          reason: 'automatic',
        }),
      ).rejects.toThrow('meeting_notes_automatic_attempts_exhausted');
      expect(getProvider).toHaveBeenCalledTimes(2);
      expect(publish).not.toHaveBeenCalled();
      expect(onUpdated).toHaveBeenCalledWith(meeting.id);
    },
  );
});

it.each(['cancel', 'source-change'] as const)(
  'does not generate after %s during provider initialization',
  async (change) => {
    const generation = vi.fn();
    const publish = vi.fn();
    let current = true;
    let release!: (provider: {
      name: string;
      generateStructuredAnalysis: typeof generation;
    }) => void;
    const provider = new Promise<{
      name: string;
      generateStructuredAnalysis: typeof generation;
    }>((resolve) => {
      release = resolve;
    });
    const getProvider = vi.fn(() => provider);
    const coordinator = createMeetingAnalysisRunCoordinator({
      db: {
        getMeeting: () => ({
          id: 'init-race',
          transcript_status: 'validated',
          transcript_json: JSON.stringify({
            segments: [{ speaker: 1, text: 'A fictional meeting.' }],
          }),
        }),
        getMeetingAnalysisPublicationRevisions: () => ({
          sourceRevision: 'source',
          eligibilityRevision: 'eligible',
          userNotesHash: 'notes',
        }),
        getMeetingAnalysisRun: () => null,
        beginMeetingAnalysisRun: vi.fn(),
        updateMeetingAnalysisRunStatus: () => true,
        updateMeetingAnalysisRunStatusIfCurrent: () => true,
        isMeetingAnalysisRunCurrent: () => current,
        publishMeetingNotesIfCurrent: publish,
        getAllEntities: () => [],
      },
      getSettings: async () => ({ llm_provider: 'ollama' }),
      getProvider,
    });
    const pending = coordinator.generateAndPublishMeetingNotes({
      meetingId: 'init-race',
      requestId: 'init-request',
      reason: 'manual',
    });
    // Attach before cancellation rejects the subscriber.
    const rejected = expect(pending).rejects.toThrow(
      change === 'cancel' ? 'cancelled' : 'meeting_notes_superseded',
    );
    await vi.waitFor(() => expect(getProvider).toHaveBeenCalledTimes(1));
    if (change === 'cancel')
      await coordinator.cancelMeetingNotes({
        meetingId: 'init-race',
        requestId: 'init-request',
      });
    else current = false;
    release({ name: 'Ollama (Local)', generateStructuredAnalysis: generation });
    await rejected;
    expect(generation).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  },
);
