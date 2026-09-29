import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbModule from '../../electron/db';
import {
  buildAgedProjectAnswer,
  buildAssigneeActionRecall,
  buildExtractiveTemporalSummary,
  buildLiveMeetingRetrievalResult,
  buildMeetingRetrievalResult,
  buildNamedPersonEvidenceQuery,
  buildPersonWorkRecall,
  buildProjectRecall,
  buildWorkingMemoryOverviewRecall,
  buildWorkspaceIntelligenceRecall,
  containsConfidentialAside,
  enforceSynthesizedOnlyContext,
  extractNamedPersonQuestionSubject,
  focusContextOnExplicitNamedSubject,
  focusContextOnNamedPerson,
  isPlanningOrPriorityQuery,
  isSelfReferentialQuery,
  matchProjectEntity,
  mergeRetrievalResultsByMeeting,
  parseAssigneeActionQuery,
  parsePersonWorkQuery,
  parseQuery,
  resolveExplicitMeetingScope,
  resolveWorkspaceIntelligenceMode,
  retrieveContext,
  selectNamedPersonAnswerContext,
  selectRecentPersonNoteContext,
  shouldKeepActivePersonScope,
  shouldKeepActiveProjectScope,
  shouldUsePreparedExtractiveAnswer,
  shouldUseWorkspaceIntelligence,
} from '../../electron/intelligence/queryEngine';
import * as factoryModule from '../../electron/llm/factory';
import type { LLMProvider, LLMSettings } from '../../electron/llm/provider';

type MockProvider = Pick<LLMProvider, 'classifyQueryIntent'>;
type EntitySearchRow = ReturnType<
  typeof dbModule.searchEntitiesWithMeetingContext
>[number];
type FtsRow = ReturnType<typeof dbModule.searchMeetingNotesFts>[number];
type SectionFtsRow = ReturnType<
  typeof dbModule.searchMeetingContextSectionsFts
>[number];
type GraphEntity = ReturnType<typeof dbModule.walkEntityGraph>[number];

vi.mock('../../electron/db', () => ({
  searchMeetingsFts: vi.fn(),
  searchMeetingNotesFts: vi.fn(),
  searchMeetingContextSectionsFts: vi.fn().mockReturnValue([]),
  searchLocalArtifacts: vi.fn().mockReturnValue([]),
  searchLocalArtifactsFts: vi.fn().mockReturnValue([]),
  searchEntitiesWithMeetingContext: vi.fn(),
  walkEntityGraph: vi.fn(),
  getTemporalMeetings: vi.fn(),
  getMeetingsForEntity: vi.fn().mockReturnValue([]),
  getMeeting: vi.fn(),
  getAskPlutoMeeting: vi.fn(),
  getEntity: vi.fn(),
  findEntity: vi.fn(),
  getCanonicalPersonCommitments: vi.fn(),
  getWorkingMemorySnapshot: vi.fn(),
  getEntitiesByType: vi.fn().mockReturnValue([]),
  resolveProjectIdentityId: vi.fn((id: string) => id),
  getProjectBrief: vi.fn().mockReturnValue(null),
  getPersonBriefing: vi.fn().mockReturnValue(null),
  getProjectPortfolio: vi.fn().mockReturnValue([]),
  identityStore: {
    getSelfPersonId: vi.fn(),
  },
  getMeetingNotesIdentityProjection: vi.fn().mockReturnValue({
    speakerDisplayNames: {},
    trustedUserTerms: [],
  }),
}));

vi.mock('../../electron/llm/factory', () => ({
  getAllSettings: vi.fn(),
  getProvider: vi.fn(),
}));

describe('Query Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dbModule.searchMeetingsFts).mockReturnValue([]);
    vi.mocked(dbModule.searchMeetingNotesFts).mockReturnValue([]);
    vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([]);
    vi.mocked(dbModule.searchLocalArtifacts).mockReturnValue([]);
    vi.mocked(dbModule.searchLocalArtifactsFts).mockReturnValue([]);
    vi.mocked(dbModule.walkEntityGraph).mockReturnValue([]);
    vi.mocked(dbModule.findEntity).mockReturnValue(undefined);
    vi.mocked(dbModule.getEntity).mockReturnValue(undefined);
    vi.mocked(dbModule.getCanonicalPersonCommitments).mockReturnValue({
      open: [],
      delivered: [],
      candidates: [],
    });
  });

  it('uses only synthesized live notes for current-meeting retrieval', () => {
    const result = buildLiveMeetingRetrievalResult({
      meetingId: 'live-1',
      title: 'Planning session',
      participants: ['Maya'],
      notes: 'The launch checklist is the current focus.',
      transcript: [
        {
          id: 'segment-1',
          speaker: 'Maya',
          text: 'Raw transcript detail must not be retrieved.',
          timestampMs: 1000,
          confirmed: true,
        },
      ],
      interimText: 'Unconfirmed interim transcript detail.',
      capturedAt: '2026-09-26T20:00:00.000Z',
    });

    expect(result.evidence_kind).toBe('note');
    expect(result.evidence_text).toContain(
      'The launch checklist is the current focus.',
    );
    expect(result.evidence_text).not.toContain('Raw transcript detail');
    expect(result.evidence_text).not.toContain('interim transcript');
  });

  it('builds saved meeting evidence without a transcript-based identity projection', () => {
    const result = buildMeetingRetrievalResult({
      id: 'meeting-1',
      title: 'Project Atlas planning',
      user_notes: 'The handoff is ready for review.',
    });

    expect(result.evidence_text).toContain('The handoff is ready for review.');
    expect(dbModule.getMeetingNotesIdentityProjection).not.toHaveBeenCalled();
  });

  describe('parseQuery', () => {
    it('extracts keywords and intent correctly', async () => {
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([]);

      const result = await parseQuery(
        'What dates did we discuss the backend migration?',
      );
      expect(result.intent).toBe('temporal');
      // Should filter out "what", "did", "we", "the"
      expect(result.keywords).toContain('dates');
      expect(result.keywords).toContain('discuss');
      expect(result.keywords).toContain('backend');
      expect(result.keywords).toContain('migration');
    });

    it('extracts entity mentions from DB mock', async () => {
      const mockProvider = {
        classifyQueryIntent: vi
          .fn()
          .mockResolvedValue('{"intent":"factual","expanded_keywords":[]}'),
      } satisfies MockProvider;
      vi.mocked(factoryModule.getProvider).mockResolvedValue(
        mockProvider as unknown as LLMProvider,
      );
      vi.mocked(factoryModule.getAllSettings).mockResolvedValue(
        {} as LLMSettings,
      );

      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([
        {
          id: '123',
          name: 'GraphQL',
          type: 'topic',
          mention_count: 5,
          context: '',
          meeting_id: 'm1',
        },
      ] as EntitySearchRow[]);

      const result = await parseQuery('Tell me about GraphQL');
      expect(result.entity_mentions).toContain('123');
    });

    it('fast-path heuristic returns conversational for greetings without LLM call', async () => {
      // The fast-path regex catches "hello" before hitting the LLM
      const result = await parseQuery('hello pluto');
      expect(result.intent).toBe('conversational');
      // LLM should NOT be called for clear greeting patterns
      expect(factoryModule.getProvider).not.toHaveBeenCalled();
    });

    it('does not treat history questions or greeting-prefixed questions as greetings', async () => {
      const history = await parseQuery('History of the API migration');
      const greetedQuestion = await parseQuery(
        'Hi, what did we decide about the API migration?',
      );

      expect(history.cannedResponse).toBeUndefined();
      expect(greetedQuestion.cannedResponse).toBeUndefined();
    });

    it('uses the LLM to classify conversational intent for ambiguous queries', async () => {
      const mockProvider = {
        classifyQueryIntent: vi
          .fn()
          .mockResolvedValue(
            '{"intent":"conversational","expanded_keywords":[]}',
          ),
      } satisfies MockProvider;
      vi.mocked(factoryModule.getProvider).mockResolvedValue(
        mockProvider as unknown as LLMProvider,
      );
      vi.mocked(factoryModule.getAllSettings).mockResolvedValue(
        {} as LLMSettings,
      );
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([]);

      // Not a greeting, but LLM classifies it as conversational
      const result = await parseQuery('are you able to help me');
      expect(result.intent).toBe('conversational');
      expect(mockProvider.classifyQueryIntent).toHaveBeenCalled();
    });

    it('uses the LLM to expand synonyms and find factual intent', async () => {
      const mockProvider = {
        classifyQueryIntent: vi
          .fn()
          .mockResolvedValue(
            '{"intent":"factual","expanded_keywords":["API","backend"]}',
          ),
      } satisfies MockProvider;
      vi.mocked(factoryModule.getProvider).mockResolvedValue(
        mockProvider as unknown as LLMProvider,
      );
      vi.mocked(factoryModule.getAllSettings).mockResolvedValue(
        {} as LLMSettings,
      );
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([]);

      const result = await parseQuery('GraphQL');
      expect(result.expanded_keywords).toContain('API');
      expect(result.expanded_keywords).toContain('backend');
      expect(result.intent).toBe('factual');
    });

    it('handles LLM failures gracefully using fallbacks', async () => {
      const mockProvider = {
        classifyQueryIntent: vi
          .fn()
          .mockRejectedValue(new Error('Out of quota')),
      } satisfies MockProvider;
      vi.mocked(factoryModule.getProvider).mockResolvedValue(
        mockProvider as unknown as LLMProvider,
      );
      vi.mocked(factoryModule.getAllSettings).mockResolvedValue(
        {} as LLMSettings,
      );

      const result = await parseQuery('when is the meeting');
      expect(result.intent).toBe('temporal'); // Fallback logic
    });

    it('uses deterministic intent routing for synchronous Ask Pluto queries', async () => {
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([]);

      const result = await parseQuery(
        'Compare the current meeting with the previous one',
        { useModelClassification: false },
      );

      expect(result.intent).toBe('comparative');
      expect(factoryModule.getProvider).not.toHaveBeenCalled();
    });

    it('routes date-bearing comparisons as comparative before temporal lookup', async () => {
      await expect(
        parseQuery('Compare the current meeting with the January plan', {
          useModelClassification: false,
        }),
      ).resolves.toMatchObject({ intent: 'comparative' });
    });

    it('resolves today as a temporal range instead of an FTS keyword', async () => {
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([]);
      const now = new Date(2026, 7, 25, 17, 30);

      const result = await parseQuery("Summarize today's meetings", {
        useModelClassification: false,
        now,
      });

      expect(result.intent).toBe('temporal');
      expect(result.keywords).not.toContain("today's");
      expect(result.temporal_range).toMatchObject({
        from: new Date(2026, 7, 25).toISOString(),
        to: new Date(2026, 7, 26).toISOString(),
        label: 'today',
      });
    });
  });

  describe('retrieveContext', () => {
    it('does not search local artifacts for Chat with Pluto retrieval', async () => {
      await retrieveContext({
        keywords: ['Juniper', 'launch'],
        expanded_keywords: [],
        entity_mentions: [],
        temporal_range: null,
        intent: 'factual',
      });

      expect(dbModule.searchLocalArtifacts).not.toHaveBeenCalled();
      expect(dbModule.searchLocalArtifactsFts).not.toHaveBeenCalled();
    });

    it('merges FTS search and graph walk seamlessly', async () => {
      const mockProvider = {
        classifyQueryIntent: vi.fn().mockResolvedValue('{"intent":"factual"}'),
      } satisfies MockProvider;
      vi.mocked(factoryModule.getProvider).mockResolvedValue(
        mockProvider as unknown as LLMProvider,
      );

      // Mock DB FTS
      vi.mocked(dbModule.searchMeetingNotesFts).mockReturnValue([
        {
          id: 'm1',
          snippet: 'some api stuff',
          started_at: '2026-01-01T00:00:00Z',
          title: 'Meeting 1',
          enhanced_notes: 'GraphQL was selected for the API.',
          transcript_json: JSON.stringify({
            segments: [{ text: 'Cobalt transcript-only phrase.' }],
          }),
        } as FtsRow,
      ]);

      // Mock DB Entity resolution & Walk
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([
        { id: 'e1' } as EntitySearchRow,
      ]);
      vi.mocked(dbModule.walkEntityGraph).mockReturnValue([
        { id: 'e2', name: 'Frontend', type: 'topic' } as GraphEntity,
      ]);

      const result = await retrieveContext({
        keywords: ['graphql'],
        expanded_keywords: [],
        entity_mentions: ['e1'],
        temporal_range: null,
        intent: 'factual',
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].meeting_id).toBe('m1');
      expect(result[0].score).toBeGreaterThan(0);
      expect(result[0].evidence_text).toContain('GraphQL was selected');
      expect(result[0].evidence_text).not.toContain('Cobalt');
      expect(dbModule.searchMeetingNotesFts).toHaveBeenCalled();
      expect(dbModule.searchMeetingsFts).not.toHaveBeenCalled();
    });

    it('uses matching note sections before transcript evidence', async () => {
      const meeting = {
        id: 'section-meeting',
        title: 'Launch review',
        started_at: '2026-09-01T10:00:00.000Z',
      } as dbModule.PersistedMeeting;
      vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([
        {
          meeting,
          section: {
            id: 1,
            meeting_id: 'section-meeting',
            section_id: 'topic:release',
            heading: 'Release timing',
            kind: 'topic',
            summary: 'The release moved to Friday.',
            content: 'The release moved to Friday after final QA.',
            entities_text: 'release QA',
            evidence_json: '[]',
            transcript_start_index: 3,
            transcript_end_index: 4,
            source_revision: 'revision-1',
            trust_status: 'grounded',
            updated_at: '2026-09-01T10:30:00.000Z',
          },
          snippet: 'Release timing',
        } satisfies SectionFtsRow,
      ]);

      const result = await retrieveContext(
        {
          keywords: ['release'],
          expanded_keywords: [],
          entity_mentions: [],
          temporal_range: null,
          intent: 'factual',
        },
        {
          query: 'What changed about the release?',
          meetingIds: ['section-meeting'],
        },
      );

      expect(result[0]).toMatchObject({
        meeting_id: 'section-meeting',
        evidence_kind: 'section',
        retrieved_sections: [
          { section_id: 'topic:release', heading: 'Release timing' },
        ],
      });
      expect(dbModule.searchMeetingNotesFts).toHaveBeenCalled();
      expect(dbModule.searchMeetingsFts).not.toHaveBeenCalled();
      expect(dbModule.searchMeetingContextSectionsFts).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ meetingIds: ['section-meeting'] }),
      );
    });

    it('keeps ordinary synthesized work while omitting a confidential section', async () => {
      const meeting = {
        id: 'mixed-meeting',
        title: 'Weekly review',
        started_at: '2026-09-01T10:00:00.000Z',
      } as dbModule.PersistedMeeting;
      const section = {
        id: 1,
        meeting_id: 'mixed-meeting',
        section_id: 'topic:release',
        heading: 'Release timing',
        kind: 'topic',
        summary: 'The release checklist is ready.',
        content: 'The release checklist is ready for review.',
        entities_text: 'release',
        evidence_json: '[]',
        transcript_start_index: null,
        transcript_end_index: null,
        source_revision: 'revision-1',
        trust_status: 'grounded',
        updated_at: '2026-09-01T10:30:00.000Z',
      } satisfies SectionFtsRow['section'];
      vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([
        { meeting, section, snippet: 'Release timing' },
        {
          meeting,
          section: {
            ...section,
            id: 2,
            section_id: 'topic:personal',
            heading: 'Personal aside',
            summary: 'Keep this discussion confidential.',
            content: 'Keep this discussion confidential between us.',
          },
          snippet: 'Personal aside',
        },
      ]);

      const result = await retrieveContext({
        keywords: ['review'],
        expanded_keywords: [],
        entity_mentions: [],
        temporal_range: null,
        intent: 'factual',
      });

      expect(result).toHaveLength(1);
      expect(
        result[0].retrieved_sections?.map((item) => item.section_id),
      ).toEqual(['topic:release']);
      expect(result[0].evidence_text).not.toContain('confidential');
    });

    it('keeps note-only matches visible while the section index is partially backfilled', async () => {
      const sectionMeeting = {
        id: 'section-meeting',
        title: 'Launch review',
        started_at: '2026-09-01T10:00:00.000Z',
      } as dbModule.PersistedMeeting;
      const noteOnlyMeeting = {
        id: 'note-only-meeting',
        title: 'Customer readiness',
        started_at: '2026-09-02T10:00:00.000Z',
        enhanced_notes:
          'The customer readiness review depends on the revised launch plan.',
      } as FtsRow;
      vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([
        {
          meeting: sectionMeeting,
          section: {
            id: 1,
            meeting_id: sectionMeeting.id,
            section_id: 'topic:release',
            heading: 'Release timing',
            kind: 'topic',
            summary: 'The release moved to Friday.',
            content: 'The release moved to Friday after final QA.',
            entities_text: 'release QA',
            evidence_json: '[]',
            transcript_start_index: null,
            transcript_end_index: null,
            source_revision: 'revision-1',
            trust_status: 'grounded',
            updated_at: '2026-09-01T10:30:00.000Z',
          },
          snippet: 'Release timing',
        } satisfies SectionFtsRow,
      ]);
      vi.mocked(dbModule.searchMeetingNotesFts).mockReturnValue([
        noteOnlyMeeting,
      ]);

      const result = await retrieveContext(
        {
          keywords: ['launch'],
          expanded_keywords: [],
          entity_mentions: [],
          temporal_range: null,
          intent: 'factual',
        },
        { query: 'What changed in the launch plan?' },
      );

      expect(result.map((item) => item.meeting_id)).toEqual(
        expect.arrayContaining(['section-meeting', 'note-only-meeting']),
      );
      expect(
        result.find((item) => item.meeting_id === 'note-only-meeting')
          ?.evidence_text,
      ).toContain('customer readiness review');
    });

    it('never deepens matching note sections into raw transcript passages', async () => {
      const meeting = {
        id: 'transcript-meeting',
        title: 'Release review',
        started_at: '2026-09-01T10:00:00.000Z',
        transcript_status: 'validated',
        transcript_json: JSON.stringify({
          segments: [
            { speaker: 'Sam', startTime: 40, text: 'Final QA is complete.' },
            {
              speaker: 'Sam',
              startTime: 42,
              text: 'The release moves to Friday.',
            },
            { speaker: 'Lee', startTime: 45, text: 'I will notify support.' },
            { speaker: 'Lee', startTime: 80, text: 'Unrelated budget topic.' },
          ],
        }),
      } as dbModule.PersistedMeeting;
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(meeting);
      vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([
        {
          meeting,
          section: {
            id: 2,
            meeting_id: meeting.id,
            section_id: 'topic:release',
            heading: 'Release timing',
            kind: 'discussion',
            summary: 'The release moved to Friday.',
            content: 'The release moved to Friday after final QA.',
            entities_text: 'release QA',
            evidence_json: '[]',
            transcript_start_index: 0,
            transcript_end_index: 2,
            source_revision: 'revision-2',
            trust_status: 'grounded',
            updated_at: '2026-09-01T10:30:00.000Z',
          },
          snippet: 'Release timing',
        } satisfies SectionFtsRow,
      ]);

      const result = await retrieveContext(
        {
          keywords: ['release', 'Friday'],
          expanded_keywords: [],
          entity_mentions: [],
          temporal_range: null,
          intent: 'factual',
        },
        { query: 'Quote exactly why the release moved to Friday.' },
      );

      expect(result[0].evidence_kind).toBe('section');
      expect(result[0].transcript_passages).toBeUndefined();
      expect(result[0].evidence_text).not.toContain('Final QA is complete');
      expect(dbModule.searchMeetingsFts).not.toHaveBeenCalled();
    });

    it('uses synthesized notes even when exact wording is requested', async () => {
      const meeting = {
        id: 'transcript-meeting',
        title: 'Release review',
        started_at: '2026-09-01T10:00:00.000Z',
        transcript_status: 'validated',
        transcript_json: JSON.stringify({
          segments: [
            { speaker: 'Sam', startTime: 40, text: 'Final QA is complete.' },
            {
              speaker: 'Sam',
              startTime: 42,
              text: 'The release moves to Friday.',
            },
          ],
        }),
      } as dbModule.PersistedMeeting;
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(meeting);
      vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([
        {
          meeting,
          section: {
            id: 2,
            meeting_id: meeting.id,
            section_id: 'topic:release',
            heading: 'Release timing',
            kind: 'discussion',
            summary: 'The release moved to Friday.',
            content: 'The release moved to Friday after final QA.',
            entities_text: 'release QA',
            evidence_json: '[]',
            transcript_start_index: 0,
            transcript_end_index: 1,
            source_revision: 'revision-2',
            trust_status: 'grounded',
            updated_at: '2026-09-01T10:30:00.000Z',
          },
          snippet: 'Release timing',
        } satisfies SectionFtsRow,
      ]);

      const result = await retrieveContext(
        {
          keywords: ['release', 'Friday'],
          expanded_keywords: [],
          entity_mentions: [],
          temporal_range: null,
          intent: 'factual',
        },
        { query: 'Quote exactly why the release moved to Friday.' },
      );

      expect(result[0].evidence_kind).toBe('section');
      expect(result[0].transcript_passages).toBeUndefined();
      expect(result[0].evidence_text).not.toContain('[Transcript passage');
      expect(result[0].evidence_text).toContain(
        'The release moved to Friday after final QA.',
      );
    });

    it('does not retrieve transcript passages for exploratory or rationale queries', async () => {
      const meeting = {
        id: 'transcript-meeting',
        title: 'Release review',
        started_at: '2026-09-01T10:00:00.000Z',
        transcript_status: 'validated',
        transcript_json: JSON.stringify({
          segments: [
            { speaker: 'Sam', startTime: 40, text: 'Final QA is complete.' },
            {
              speaker: 'Sam',
              startTime: 42,
              text: 'The release moves to Friday.',
            },
          ],
        }),
      } as dbModule.PersistedMeeting;
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(meeting);
      vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([
        {
          meeting,
          section: {
            id: 2,
            meeting_id: meeting.id,
            section_id: 'topic:release',
            heading: 'Release timing',
            kind: 'discussion',
            summary: 'The release moved to Friday.',
            content: 'The release moved to Friday after final QA.',
            entities_text: 'release QA',
            evidence_json: '[]',
            transcript_start_index: 0,
            transcript_end_index: 1,
            source_revision: 'revision-2',
            trust_status: 'grounded',
            updated_at: '2026-09-01T10:30:00.000Z',
          },
          snippet: 'Release timing',
        } satisfies SectionFtsRow,
      ]);

      const result = await retrieveContext(
        {
          keywords: ['release', 'Friday'],
          expanded_keywords: [],
          entity_mentions: [],
          temporal_range: null,
          intent: 'factual',
        },
        {
          query:
            'Why did the team change the release date and what is the rationale?',
        },
      );

      expect(result[0].evidence_kind).toBe('section');
      expect(result[0].transcript_passages).toBeUndefined();
      expect(result[0].evidence_text).not.toContain('[Transcript passage');
    });
  });

  describe('mergeRetrievalResultsByMeeting', () => {
    it('keeps one context item when temporal and inherited scopes contain the same meeting', () => {
      const temporal = {
        meeting_id: 'meeting-1',
        meeting_title: 'Today review',
        mid: null,
        evidence_text: 'Temporal evidence',
        score: 1,
        score_breakdown: {
          fts_rank: 0,
          graph_proximity: 0,
          recency_decay: 1,
          mention_weight: 0,
        },
      };
      const inherited = {
        ...temporal,
        evidence_text: 'Inherited duplicate evidence',
      };

      expect(mergeRetrievalResultsByMeeting([temporal], [inherited])).toEqual([
        temporal,
      ]);
    });
  });

  describe('buildExtractiveTemporalSummary', () => {
    it('returns named completed analysis and omits contextless fragments', () => {
      const result = buildExtractiveTemporalSummary(
        "Summarize today's meetings",
        [
          {
            meeting_id: 'review',
            meeting_title: 'Transcription System Performance Review',
            mid: null,
            evidence_text:
              '[Current meeting]: Transcription System Performance Review\n[Analysis]: The team identified a recording delay missing the first twenty seconds of audio and evaluated live transcription refinement.',
            score: 1,
            score_breakdown: {
              fts_rank: 0,
              graph_proximity: 0,
              recency_decay: 1,
              mention_weight: 0,
            },
          },
          {
            meeting_id: 'vague',
            meeting_title: 'Meeting',
            mid: null,
            evidence_text:
              "[Current meeting]: Meeting\n[Analysis]: One speaker expressed embarrassment about an application's origin.",
            score: 1,
            score_breakdown: {
              fts_rank: 0,
              graph_proximity: 0,
              recency_decay: 1,
              mention_weight: 0,
            },
          },
        ],
      );

      expect(result).toBe(
        'Transcription System Performance Review: The team identified a recording delay missing the first twenty seconds of audio. [Source 1]',
      );
    });

    it('leaves non-summary follow-ups to model synthesis', () => {
      expect(buildExtractiveTemporalSummary('What else came up?', [])).toBe(
        null,
      );
    });

    it('answers what happened from one named meeting with prepared analysis', () => {
      expect(
        buildExtractiveTemporalSummary(
          'What happened in the current meeting?',
          [
            {
              meeting_id: 'current',
              meeting_title: 'Recording review',
              mid: null,
              evidence_text:
                '[Current meeting]: Recording review\n[Analysis]: The team found a twenty-second recording gap and assigned an audio capture investigation.',
              score: 1,
              score_breakdown: {
                fts_rank: 0,
                graph_proximity: 0,
                recency_decay: 1,
                mention_weight: 0,
              },
            },
          ],
        ),
      ).toBe(
        'Recording review: The team found a twenty-second recording gap and assigned an audio capture investigation. [Source 1]',
      );
    });

    it('treats recap requests as prepared-summary requests', () => {
      expect(
        buildExtractiveTemporalSummary("Give me a recap of today's meeting", [
          {
            meeting_id: 'current',
            meeting_title: 'Recording review',
            mid: null,
            evidence_text:
              '[Current meeting]: Recording review\n[Analysis]: The team found a twenty-second recording gap and assigned an audio capture investigation.',
            score: 1,
            score_breakdown: {
              fts_rank: 0,
              graph_proximity: 0,
              recency_decay: 1,
              mention_weight: 0,
            },
          },
        ]),
      ).toBe(
        'Recording review: The team found a twenty-second recording gap and assigned an audio capture investigation. [Source 1]',
      );
    });

    it('returns prepared decisions without model synthesis', () => {
      expect(
        buildExtractiveTemporalSummary('What did we decide?', [
          {
            meeting_id: 'current',
            meeting_title: 'Architecture review',
            mid: null,
            evidence_text:
              '[Current meeting]: Architecture review\n[Decisions]: Use SQLite for local storage.',
            score: 1,
            score_breakdown: {
              fts_rank: 0,
              graph_proximity: 0,
              recency_decay: 1,
              mention_weight: 0,
            },
          },
        ]),
      ).toBe('Architecture review: Use SQLite for local storage. [Source 1]');
    });

    it('returns prepared action items without model synthesis', () => {
      expect(
        buildExtractiveTemporalSummary('What are the next steps?', [
          {
            meeting_id: 'current',
            meeting_title: 'Launch review',
            mid: null,
            evidence_text:
              '[Current meeting]: Launch review\n[Action items]: Sam will send the customer update.',
            score: 1,
            score_breakdown: {
              fts_rank: 0,
              graph_proximity: 0,
              recency_decay: 1,
              mention_weight: 0,
            },
          },
        ]),
      ).toBe('Launch review: Sam will send the customer update. [Source 1]');
    });
  });

  describe('buildAssigneeActionRecall', () => {
    const meetings = [
      {
        id: 'planning',
        title: 'Launch planning',
        started_at: '2026-08-31T18:00:00.000Z',
        enhanced_notes:
          'The revised launch plan unblocks the customer readiness review.',
        mid_json: JSON.stringify({
          mid_version: 1,
          meeting_id: 'planning',
          title: 'Launch planning',
          occurred_at: '2026-08-31T18:00:00.000Z',
          duration_seconds: 1200,
          participants: [],
          projects: [],
          topics: [],
          decisions: [],
          signals: {
            continuity: [],
            accountability_risks: [],
            decision_impacts: [],
          },
          evidence_spans: [],
          action_items: [
            {
              entity_id: 'action-1',
              description: 'Send the revised launch plan to the team.',
              assignee: 'Gamma',
              due_date: '2026-09-03',
              status: 'active',
            },
            {
              entity_id: 'action-2',
              description: 'Archive the old launch checklist.',
              assignee: 'Gamma',
              status: 'completed',
            },
            {
              entity_id: 'action-3',
              description: 'Send the updated launch plan to the team.',
              assignee: 'Gamma',
              due_date: '2026-09-03',
              status: 'active',
            },
          ],
        }),
      },
      {
        id: 'review',
        title: 'Product review',
        started_at: '2026-08-30T18:00:00.000Z',
        analysis_json: JSON.stringify({
          analysis_schema_version: 3,
          overview: 'The team reviewed onboarding.',
          topics: [],
          all_decisions: [],
          all_action_items: [
            {
              text: 'Share the onboarding recordings.',
              assignee: 'gamma',
              status: 'active',
            },
          ],
        }),
      },
    ] as dbModule.PersistedMeeting[];

    it('answers the exact generated assignee suggestion from structured intelligence', () => {
      const recall = buildAssigneeActionRecall(
        "What's assigned to Gamma?",
        meetings,
      );

      expect(recall).not.toBeNull();
      expect(recall?.assignee).toBe('Gamma');
      expect(recall?.answer).toContain(
        '- Send the revised launch plan to the team. Due Sep 3. [Source 1]',
      );
      expect(recall?.answer).toContain(
        '- Share the onboarding recordings. [Source 2]',
      );
      expect(recall?.answer).not.toContain('Archive the old launch checklist');
      expect(recall?.answer).not.toContain('Send the updated launch plan');
      expect(recall?.context.map((source) => source.meeting_id)).toEqual([
        'planning',
        'review',
      ]);
    });

    it('recognizes natural ownership variants without matching unrelated questions', () => {
      expect(buildAssigneeActionRecall('What does Gamma own?', meetings)).not
        .toBeNull;
      expect(
        buildAssigneeActionRecall("What are Gamma's action items?", meetings),
      ).not.toBeNull;
      expect(
        buildAssigneeActionRecall('What did Gamma say about launch?', meetings),
      ).toBeNull();
    });

    it('returns an immediate no-evidence answer for a recognized assignee lookup', () => {
      expect(
        buildAssigneeActionRecall("What's assigned to Priya?", meetings),
      ).toMatchObject({
        assignee: 'Priya',
        answer: "I couldn't find any open action items assigned to Priya.",
        context: [],
      });
    });

    it('marks structured recall as incomplete when the person appears in other meeting notes', () => {
      const recall = buildAssigneeActionRecall("What's assigned to Gamma?", [
        meetings[0],
        {
          id: 'other-person-c-meeting',
          title: 'Partner follow-up',
          enhanced_notes:
            'Gamma discussed several next steps, but the saved notes do not name an owner.',
        } as dbModule.PersistedMeeting,
      ]);

      expect(recall).toMatchObject({
        coverageLimited: true,
        mentionedMeetingCount: 2,
      });
      expect(recall?.context).toHaveLength(1);
    });

    it('resolves “me” through the confirmed self identity and canonical commitments', () => {
      const self = { id: 'person-self', name: 'Alpha', type: 'person' };
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(
        self.id,
      );
      vi.mocked(dbModule.getEntity).mockImplementation((id) =>
        id === self.id
          ? (self as ReturnType<typeof dbModule.getEntity>)
          : undefined,
      );
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(meetings[0]);
      vi.mocked(dbModule.getCanonicalPersonCommitments).mockReturnValue({
        open: [
          {
            id: 'commitment-1',
            text: 'Send the revised launch plan.',
            status: 'open',
            dueDate: '2026-09-03',
            sourceMeetingId: 'planning',
            sourceKind: 'mid',
            evidence: 'Alpha will send the revised launch plan.',
          },
        ],
        delivered: [
          {
            id: 'commitment-completed',
            text: 'Archive the old checklist.',
            status: 'completed',
            dueDate: null,
            sourceMeetingId: 'planning',
            sourceKind: 'mid',
            evidence: null,
          },
        ],
        candidates: [
          {
            id: 'commitment-candidate',
            text: 'Maybe prepare the customer appendix.',
            status: 'active',
            dueDate: null,
            sourceMeetingId: 'planning',
            sourceMeetingTitle: 'Launch planning',
            evidence: 'Could you prepare the customer appendix?',
            updatedAt: '2026-09-01T12:00:00.000Z',
            suggestedOwnerName: 'Alpha',
          },
        ],
      });

      const recall = buildAssigneeActionRecall(
        "What's assigned to me?",
        meetings,
      );

      expect(recall).toMatchObject({
        assignee: 'you',
        commitmentCount: 1,
        coverageLimited: false,
      });
      expect(recall?.answer).toContain('Send the revised launch plan');
      expect(recall?.answer).toContain(
        'Possible follow-ups — ownership is not confirmed:',
      );
      expect(recall?.answer).toContain('Maybe prepare the customer appendix');
      expect(recall?.answer).not.toContain('Archive the old checklist');
      expect(dbModule.getCanonicalPersonCommitments).toHaveBeenCalledWith(
        'person-self',
      );
      expect(recall?.context[0].evidence_text).toContain(
        'The revised launch plan unblocks the customer readiness review.',
      );
      expect(recall?.context[0].evidence_text).toContain(
        '[Commitments]:\nConfirmed assignment: Send the revised launch plan.',
      );

      const completed = buildAssigneeActionRecall(
        'What are my completed commitments?',
        meetings,
      );
      expect(completed?.answer).toContain('Archive the old checklist');
      expect(completed?.answer).not.toContain('Send the revised launch plan');

      const accomplishments = buildAssigneeActionRecall(
        'Generate my quarterly accomplishments',
        meetings,
      );
      expect(accomplishments?.answer).toContain('Archive the old checklist');
      expect(accomplishments?.answer).not.toContain(
        'Send the revised launch plan',
      );
    });

    it('routes priority and focus queries to self commitments sorted by due date', () => {
      expect(parseAssigneeActionQuery('what should i be focus on?')).toBe('me');
      expect(parseAssigneeActionQuery('what should i focus on?')).toBe('me');
      expect(parseAssigneeActionQuery('what should i be working on?')).toBe(
        'me',
      );
      expect(parseAssigneeActionQuery('what are my priorities?')).toBe('me');
      expect(parseAssigneeActionQuery("what's on my plate?")).toBe('me');
      expect(parseAssigneeActionQuery('what is on my plate?')).toBe('me');
      expect(parseAssigneeActionQuery('what do i need to focus on?')).toBe(
        'me',
      );
      expect(
        parseAssigneeActionQuery('what am i supposed to be working on?'),
      ).toBe('me');

      expect(isSelfReferentialQuery('what should i be focus on?')).toBe(true);
      expect(isSelfReferentialQuery('what should i focus on?')).toBe(true);
      expect(isSelfReferentialQuery('what should i be working on?')).toBe(true);
      expect(isSelfReferentialQuery('what are my priorities?')).toBe(true);
      expect(isSelfReferentialQuery("what's on my plate?")).toBe(true);

      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(
        'person-self',
      );
      vi.mocked(dbModule.getEntity).mockReturnValue({
        id: 'person-self',
        name: 'Alpha',
        type: 'person',
      } as any);
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(meetings[0]);
      vi.mocked(dbModule.getCanonicalPersonCommitments).mockReturnValue({
        open: [
          {
            id: 'commitment-nodate',
            text: 'Cloud deployment setup.',
            status: 'open',
            dueDate: null,
            sourceMeetingId: 'planning',
            sourceKind: 'mid',
            evidence: 'Alpha will set up cloud deployment.',
          },
          {
            id: 'commitment-urgent',
            text: 'Finish the hardened pipeline for Beta Reviewer.',
            status: 'open',
            dueDate: '2026-09-02',
            sourceMeetingId: 'planning',
            sourceKind: 'mid',
            evidence: 'Alpha committed to finishing the hardened pipeline.',
          },
        ],
        delivered: [],
        candidates: [],
      });

      const recall = buildAssigneeActionRecall(
        'what should i be focus on?',
        meetings,
      );

      expect(recall).toMatchObject({
        assignee: 'you',
        commitmentCount: 2,
        coverageLimited: false,
      });
      expect(recall?.answer).toContain(
        'Here is what is currently on your plate, based on your open commitments:',
      );
      const urgentIndex =
        recall?.answer.indexOf(
          'Finish the hardened pipeline for Beta Reviewer',
        ) ?? -1;
      const nodateIndex =
        recall?.answer.indexOf('Cloud deployment setup') ?? -1;
      expect(urgentIndex).toBeGreaterThan(-1);
      expect(nodateIndex).toBeGreaterThan(-1);
      expect(urgentIndex).toBeLessThan(nodateIndex);
    });
  });

  describe('buildPersonWorkRecall', () => {
    it('keeps a named person overview scoped through a pronoun follow-up', () => {
      vi.mocked(dbModule.findEntity).mockImplementation((type, name) =>
        type === 'person' && name === 'Gamma'
          ? ({
              id: 'person-c',
              type: 'person',
              name: 'Gamma',
            } as dbModule.Entity)
          : undefined,
      );

      expect(parsePersonWorkQuery('Tell me about Gamma?')).toBe('Gamma');
      expect(
        parsePersonWorkQuery('Tell me about Gamma?\nHow should I coach him?'),
      ).toBe('Gamma');
      expect(
        parsePersonWorkQuery('Tell me about service reliability?'),
      ).toBeNull();
    });

    it('uses the synthesized person dossier for current-work questions and follow-ups', () => {
      const person = {
        id: 'person-c',
        type: 'person',
        name: 'Gamma',
      } as dbModule.Entity;
      vi.mocked(dbModule.findEntity).mockReturnValue(person);
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue({
        person,
        meetings: [],
        commitments: {
          open: [
            {
              id: 'commitment-1',
              text: 'Stabilize the ranking pipeline in development.',
              dueDate: null,
              evidence: 'The current project brief names this as active work.',
            },
          ],
          delivered: [],
          candidates: [],
        },
        isSelf: false,
        knowledgeDoc: {
          rendered_content:
            'Gamma is stabilizing the ranking pipeline and resolving UAT errors.',
          last_synthesized_at: '2026-09-01T12:00:00Z',
        },
        workingMemorySnapshot: null,
        mergedPeople: [],
      } as unknown as dbModule.PersonBriefingDetail);

      const explicit = buildPersonWorkRecall(
        'What is Gamma working on right now?',
      );
      const inherited = buildPersonWorkRecall(
        'Which item is most urgent?',
        'Gamma',
      );
      const expectation = buildPersonWorkRecall(
        'What do you think will satisfy Alpha Contact in terms of their expectations?',
      );

      expect(explicit).toMatchObject({
        displayTitle: 'Gamma',
        context: [
          {
            meeting_id: 'person:person-c',
            source_type: 'artifact',
            evidence_kind: 'artifact',
            trust_status: 'grounded',
          },
        ],
      });
      expect(explicit?.context[0].evidence_text).toContain(
        'Stabilize the ranking pipeline',
      );
      expect(explicit?.context[0].evidence_text).toContain(
        '[Profile as of]: 2026-09-01T12:00:00Z',
      );
      expect(explicit?.context[0].evidence_text).toContain(
        '[Last recorded person brief]:',
      );
      expect(inherited?.person.id).toBe('person-c');
      expect(expectation?.person.id).toBe('person-c');
      expect(dbModule.findEntity).toHaveBeenCalledWith(
        'person',
        'Alpha Contact',
      );
      expect(explicit?.context[0].transcript_passages).toBeUndefined();
    });
  });

  describe('focusContextOnNamedPerson', () => {
    it('adds only newer person-specific synthesized notes to a dated profile', () => {
      const source = (
        meeting_id: string,
        occurred: string,
        detail: string,
      ) => ({
        meeting_id,
        mid: null,
        evidence_text: `[Section match]: Weekly review\n[Occurred]: ${occurred}\n[Section: Work]: ${detail}`,
        evidence_kind: 'section' as const,
        score: 1,
        score_breakdown: {
          fts_rank: 1,
          graph_proximity: 0,
          recency_decay: 1,
          mention_weight: 0,
        },
      });
      const selected = selectRecentPersonNoteContext(
        [
          source(
            'unrelated',
            '2026-09-20',
            'The deployment checklist advanced.',
          ),
          source('older', '2026-09-01', 'Gamma reviewed the rollout.'),
          source(
            'private',
            '2026-09-21',
            'Keep Gamma’s personal aside confidential.',
          ),
          source(
            'newer',
            '2026-09-19',
            'Gamma reviewed the release plan. Another team discussed travel.',
          ),
        ],
        'Gamma',
        '2026-09-04T12:00:00Z',
      );

      expect(selected.map((result) => result.meeting_id)).toEqual(['newer']);
      expect(selected[0].evidence_text).toContain('Gamma reviewed');
      expect(selected[0].evidence_text).not.toContain('travel');
      expect(selected[0].mid).toBeNull();
    });

    it('does not inherit a previous person when a new person is named', () => {
      expect(
        shouldKeepActivePersonScope({
          relation: 'follow_up',
          hasActivePerson: true,
          hasExplicitPersonSubject: true,
          hasExplicitProject: false,
        }),
      ).toBe(false);
      expect(
        shouldKeepActivePersonScope({
          relation: 'expansion',
          hasActivePerson: true,
          hasExplicitPersonSubject: false,
          hasExplicitProject: false,
        }),
      ).toBe(true);
    });
    it('does not treat individual FTS words as evidence for a named subject', () => {
      const source = (meeting_id: string, evidence_text: string) => ({
        meeting_id,
        meeting_title: 'Planning notes',
        mid: null,
        evidence_text,
        score: 1,
        score_breakdown: {
          fts_rank: 1,
          graph_proximity: 0,
          recency_decay: 1,
          mention_weight: 0,
        },
      });
      const context = [
        source('unrelated', 'The launch pipeline needs a review.'),
        source('relevant', 'The Copper Kite Launch was approved.'),
      ];
      expect(
        focusContextOnExplicitNamedSubject(
          'What did we decide about the Copper Kite Launch?',
          context,
        ).map((item) => item.meeting_id),
      ).toEqual(['relevant']);
      expect(
        focusContextOnExplicitNamedSubject(
          'What did we decide about the Violet River Launch?',
          context,
        ),
      ).toEqual([]);
    });

    it('uses the person-relevant clause without an adjacent project-association question', () => {
      expect(
        buildNamedPersonEvidenceQuery(
          'What is needed for Beta Reviewer? Is it for the Project Atlas project, and who said it?',
          'Beta Reviewer',
        ),
      ).toBe('What is needed for Beta Reviewer');
      expect(
        buildNamedPersonEvidenceQuery(
          'Who said that we need to present this to Beta Reviewer?',
          'Beta Reviewer',
        ),
      ).toBe('we need to present this to Beta Reviewer');
    });

    it('keeps person-specific synthesized notes without dropping to transcripts', () => {
      const contexts = [
        {
          meeting_id: 'person-a-note',
          meeting_title: 'Project Atlas daily check-in',
          mid: null,
          evidence_text:
            'The dossier for Alpha Contact needs corrected email data.',
          score: 1,
          score_breakdown: {
            fts_rank: 1,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
        {
          meeting_id: 'person-b-note',
          meeting_title: 'Advisor engagement',
          mid: null,
          evidence_text:
            'The deployed application will be shown to Beta Reviewer.',
          score: 1,
          score_breakdown: {
            fts_rank: 1,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ];

      expect(
        extractNamedPersonQuestionSubject(
          'What do you think will satisfy Alpha Contact in terms of their expectations?',
        ),
      ).toBe('Alpha Contact');
      expect(
        focusContextOnNamedPerson(
          'What do you think will satisfy Alpha Contact in terms of their expectations?',
          contexts,
        ).map((result) => result.meeting_id),
      ).toEqual(['person-a-note']);
      expect(
        focusContextOnNamedPerson(
          'Who said that we need to present this to Beta Reviewer?',
          contexts,
        ).map((result) => result.meeting_id),
      ).toEqual(['person-b-note']);
      expect(
        focusContextOnNamedPerson(
          'What is Alpha Contact working on right now?',
          contexts,
        ).map((result) => result.meeting_id),
      ).toEqual(['person-a-note']);
      expect(
        focusContextOnNamedPerson(
          'What is Missing Contact working on right now?',
          contexts,
        ),
      ).toEqual([]);
      expect(
        selectNamedPersonAnswerContext(
          'What is needed for Beta Reviewer?',
          contexts,
          [],
        ).map((result) => result.meeting_id),
      ).toEqual(['person-b-note']);
      expect(
        selectNamedPersonAnswerContext(
          'What is needed for Beta Reviewer?',
          contexts,
          [{ ...contexts[1], meeting_id: 'confirmed-assignment' }],
        ).map((result) => result.meeting_id),
      ).toEqual(['confirmed-assignment']);
    });
  });

  describe('buildWorkingMemoryOverviewRecall', () => {
    it('uses working-memory citations as navigation to meeting evidence', () => {
      const meeting = {
        id: 'overview-meeting',
        title: 'Company planning',
        started_at: '2026-09-01T10:00:00.000Z',
      } as dbModule.PersistedMeeting;
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(meeting);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        trust_status: 'grounded',
        payload: {
          evidence_index: [
            {
              meeting_id: 'overview-meeting',
              quote: 'The team prioritized launch reliability.',
            },
          ],
        },
      } as ReturnType<typeof dbModule.getWorkingMemorySnapshot>);

      const recall = buildWorkingMemoryOverviewRecall(
        'Give me a global overview across meetings',
        [],
      );

      expect(recall).toMatchObject({
        scope: 'global',
        context: [
          {
            meeting_id: 'overview-meeting',
            evidence_kind: 'overview',
          },
        ],
      });
      expect(recall?.context[0].evidence_text).toContain(
        'The team prioritized launch reliability.',
      );
    });
  });

  describe('explicit meeting scope', () => {
    const meetings = [
      {
        id: 'latest',
        title: 'Weekly planning',
        started_at: '2026-08-25T19:00:00.000Z',
      },
      {
        id: 'diagnosis',
        title: 'Live Transcript Diagnosis',
        started_at: '2026-08-21T18:16:43.967Z',
      },
      {
        id: 'older',
        title: 'Architecture review',
        started_at: '2026-08-20T18:00:00.000Z',
      },
    ] as dbModule.PersistedMeeting[];

    it('pins a specifically named meeting instead of running a global search', () => {
      expect(
        resolveExplicitMeetingScope(
          "What action items came out of Friday's Live Transcript Diagnosis?",
          meetings,
        ),
      ).toMatchObject({
        kind: 'named',
        label: 'Live Transcript Diagnosis',
        meetings: [{ id: 'diagnosis' }],
      });
    });

    it('resolves recent meetings to a bounded newest-first scope', () => {
      expect(
        resolveExplicitMeetingScope(
          'Show me a breakdown of my recent meetings please',
          meetings,
          2,
        ),
      ).toMatchObject({
        kind: 'recent',
        meetings: [{ id: 'latest' }, { id: 'diagnosis' }],
      });
    });

    it('resolves an explicit last-N request without silently using the default', () => {
      expect(
        resolveExplicitMeetingScope(
          'Looking at my last two meetings, what could I have done better?',
          meetings,
        ),
      ).toMatchObject({
        kind: 'recent',
        label: 'your last 2 meetings',
        meetings: [{ id: 'latest' }, { id: 'diagnosis' }],
      });
      expect(
        resolveExplicitMeetingScope('Analyze my previous 1 meeting', meetings),
      ).toMatchObject({
        label: 'your last 1 meeting',
        meetings: [{ id: 'latest' }],
      });
    });

    it('does not treat generic Meeting titles as explicit references', () => {
      expect(
        resolveExplicitMeetingScope('What was discussed in the meeting?', [
          { id: 'generic', title: 'Meeting' } as dbModule.PersistedMeeting,
        ]),
      ).toBeNull();
    });
  });

  it('includes structured action items and occurrence time in meeting evidence', () => {
    const result = buildMeetingRetrievalResult({
      id: 'diagnosis',
      title: 'Live Transcript Diagnosis',
      started_at: '2026-08-21T18:16:43.967Z',
      analysis_json: JSON.stringify({
        analysis_schema_version: 3,
        overview: 'The team reviewed live transcription reliability.',
        all_action_items: [
          {
            description:
              'Select a suitable YouTube video and rerun the transcript analysis evaluation.',
          },
        ],
      }),
    } as dbModule.PersistedMeeting);

    expect(result.evidence_text).toContain(
      '[Occurred]: 2026-08-21T18:16:43.967Z',
    );
    expect(result.evidence_text).toContain(
      '[Action items]: Select a suitable YouTube video and rerun the transcript analysis evaluation.',
    );
  });

  it('never includes transcript text in normal saved meeting evidence', () => {
    const result = buildMeetingRetrievalResult({
      id: 'meeting-1',
      title: 'Release review',
      enhanced_notes: 'Launch moved to Friday.',
      transcript_json: JSON.stringify({
        segments: [{ text: 'Cobalt transcript-only phrase.' }],
      }),
    } as dbModule.PersistedMeeting);

    expect(result.evidence_text).toContain('Launch moved to Friday.');
    expect(result.evidence_text).not.toContain('Cobalt');
    expect(result.evidence_text).not.toContain('[Transcript');
  });

  it('uses prepared extractive answers only for one-meeting Fast requests', () => {
    expect(
      shouldUsePreparedExtractiveAnswer({ mode: 'fast', contextCount: 1 }),
    ).toBe(true);
    expect(
      shouldUsePreparedExtractiveAnswer({ mode: 'fast', contextCount: 3 }),
    ).toBe(false);
    expect(
      shouldUsePreparedExtractiveAnswer({ mode: 'deep', contextCount: 1 }),
    ).toBe(false);
  });

  describe('project wiring and recall', () => {
    it('keeps an active project for weak follow-up matches but permits explicit switches', () => {
      expect(
        shouldKeepActiveProjectScope({
          relation: 'follow_up',
          hasActiveProject: true,
          candidateMatchKind: 'key_term',
        }),
      ).toBe(true);
      expect(
        shouldKeepActiveProjectScope({
          relation: 'follow_up',
          hasActiveProject: true,
          candidateMatchKind: 'entity_mention',
        }),
      ).toBe(true);
      expect(
        shouldKeepActiveProjectScope({
          relation: 'follow_up',
          hasActiveProject: true,
          candidateMatchKind: 'explicit_label',
        }),
      ).toBe(false);
      expect(
        shouldKeepActiveProjectScope({
          relation: 'new_topic',
          hasActiveProject: true,
          candidateMatchKind: 'key_term',
        }),
      ).toBe(false);
    });

    it('matches projects by name, display label, and key terms', () => {
      const mockProject = {
        id: 'proj-1',
        type: 'project',
        name: 'Email Generation Pipeline',
        metadata: JSON.stringify({
          projectDisplayTitle: 'Client Email Automation',
          projectThemeSynthesis: {
            version: 1,
            outcome: 'Automate client email generation and review',
            currentFocus: 'Draft review pipeline',
            sourceMeetingIds: [],
            candidateProjectIds: [],
            recentChanges: [],
            openThreads: [],
            synthesizedAt: '2026-09-01T00:00:00Z',
          },
        }),
      };
      vi.mocked(dbModule.getEntitiesByType).mockReturnValue([
        mockProject as any,
      ]);
      vi.mocked(dbModule.resolveProjectIdentityId).mockReturnValue('proj-1');
      vi.mocked(dbModule.getEntity).mockReturnValue(mockProject as any);

      // Match by exact name
      const matchByName = matchProjectEntity(
        'What happened with the Email Generation Pipeline?',
      );
      expect(matchByName).not.toBeNull();
      expect(matchByName?.name).toBe('Email Generation Pipeline');
      expect(matchByName?.displayTitle).toBe('Client Email Automation');
      expect(matchByName?.matchKind).toBe('explicit_label');

      // Match by display title (label)
      const matchByLabel = matchProjectEntity(
        'Give me an update on Client Email Automation',
      );
      expect(matchByLabel).not.toBeNull();
      expect(matchByLabel?.id).toBe('proj-1');

      // Match by key terms when query refers to project
      const matchByTerm = matchProjectEntity(
        'What is the roadmap for the project draft review pipeline?',
      );
      expect(matchByTerm).not.toBeNull();
      expect(matchByTerm?.id).toBe('proj-1');
      expect(matchByTerm?.matchKind).toBe('key_term');
    });

    it('prefers the most specific named project over a generic overlapping term', () => {
      vi.mocked(dbModule.getEntitiesByType).mockReturnValue([
        {
          id: 'pipeline-project',
          type: 'project',
          name: 'Pipeline',
          metadata: JSON.stringify({ projectDisplayTitle: 'Pipeline' }),
        } as any,
        {
          id: 'atlas-project',
          type: 'project',
          name: 'Project Atlas',
          metadata: JSON.stringify({ projectDisplayTitle: 'Project Atlas' }),
        } as any,
      ]);

      const match = matchProjectEntity(
        'Can we dive into more details about Project Atlas and the pipeline there?',
      );

      expect(match?.id).toBe('atlas-project');
      expect(match?.displayTitle).toBe('Project Atlas');
    });

    it('does not let a generic Project entity override the named Pluto project', () => {
      vi.mocked(dbModule.getEntitiesByType).mockReturnValue([
        {
          id: 'generic-project',
          type: 'project',
          name: 'Project',
          metadata: JSON.stringify({ projectDisplayTitle: 'Project' }),
        } as any,
        {
          id: 'pluto-project',
          type: 'project',
          name: 'Pluto',
          metadata: JSON.stringify({ projectDisplayTitle: 'Pluto' }),
        } as any,
      ]);

      expect(
        matchProjectEntity('Give me a current read on the Pluto project.'),
      ).toMatchObject({ id: 'pluto-project', displayTitle: 'Pluto' });
      expect(matchProjectEntity('Give me a current read on the project.')).toBe(
        null,
      );
    });

    it('builds structured project recall with theme, milestones, tasks, and meetings', () => {
      const mockProject = {
        id: 'proj-1',
        type: 'project',
        name: 'Email Generation Pipeline',
        status: 'active',
        metadata: JSON.stringify({
          projectDisplayTitle: 'Client Email Automation',
          projectThemeSynthesis: {
            version: 1,
            outcome: 'Automate client email generation',
            currentFocus: 'Security compliance review',
            sourceMeetingIds: ['meet-1'],
            candidateProjectIds: [],
            recentChanges: [
              {
                sourceMeetingId: 'meet-1',
                evidenceQuote: 'q',
                summary: 'Added sandbox testing',
              },
            ],
            openThreads: [
              {
                sourceMeetingId: 'meet-1',
                evidenceQuote: 'q',
                kind: 'risk',
                text: 'Rate limiting on provider',
              },
            ],
            synthesizedAt: '2026-09-01T00:00:00Z',
          },
        }),
      };
      vi.mocked(dbModule.getEntitiesByType).mockReturnValue([
        mockProject as any,
      ]);
      vi.mocked(dbModule.resolveProjectIdentityId).mockReturnValue('proj-1');
      vi.mocked(dbModule.getEntity).mockReturnValue(mockProject as any);
      vi.mocked(dbModule.getProjectBrief).mockReturnValue({
        project: {
          id: 'proj-1',
          displayTitle: 'Client Email Automation',
          detectedTitle: 'Email Generation Pipeline',
          metadata: mockProject.metadata,
          status: 'active',
        },
        theme: {
          outcome: 'Automate client email generation',
          currentFocus: 'Security compliance review',
          recentChanges: [
            {
              sourceMeetingId: 'meet-1',
              evidenceQuote: 'q',
              summary: 'Added sandbox testing',
            },
          ],
          openThreads: [
            {
              sourceMeetingId: 'meet-1',
              evidenceQuote: 'q',
              kind: 'risk',
              text: 'Rate limiting on provider',
            },
          ],
        } as any,
        milestones: [
          {
            id: 'm1',
            title: 'Beta deployment',
            status: 'in_progress',
            targetDate: '2026-10-01',
          } as any,
          {
            id: 'm2',
            title: 'Preview rollout',
            status: 'overdue',
            targetDate: '2025-01-01',
          } as any,
        ],
        tasks: [
          {
            id: 't1',
            name: 'Verify SMTP TLS',
            status: 'open',
            assigned_to: 'Gamma',
            due_date: '2026-09-28',
          } as any,
        ],
        meetings: [
          {
            id: 'meet-1',
            title: 'Email Pipeline Sync',
            started_at: '2026-09-20T10:00:00Z',
            context: 'Reviewed sandbox test results',
          } as any,
          {
            id: 'meet-old',
            title: 'Older Email Pipeline Sync',
            started_at: '2026-08-20T10:00:00Z',
            context: 'Discussed the initial pilot',
          } as any,
        ],
        mergedProjects: [],
        meetingStats: {} as any,
        momentum: {} as any,
        health: {
          state: 'appears_on_track',
          headline: 'On track',
          summary: 'Good progress',
        } as any,
      });
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        trust_status: 'grounded',
        generated_at: '2026-09-16T10:00:00Z',
        payload: {
          current_read: {
            headline: 'Pipeline undergoing security review',
            supporting_bullets: [
              'Sandbox completed',
              'Rate limiting monitored',
            ],
          },
        },
      } as any);
      vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([
        {
          meeting: {
            id: 'meet-old',
            title: 'Older Email Pipeline Sync',
            started_at: '2026-08-20T10:00:00Z',
            enhanced_notes: 'Discussed the initial pilot.',
          } as dbModule.PersistedMeeting,
          section: {
            id: 2,
            meeting_id: 'meet-old',
            section_id: 'topic:older-client-email-automation',
            heading: 'Client Email Automation pilot',
            kind: 'topic',
            summary: 'The pilot was being planned.',
            content: 'The Client Email Automation pilot was being planned.',
            entities_text: 'Client Email Automation pilot',
            evidence_json: '[]',
            transcript_start_index: null,
            transcript_end_index: null,
            source_revision: 'revision-old',
            trust_status: 'grounded',
            updated_at: '2026-08-20T10:30:00Z',
          },
          snippet: 'Client Email Automation pilot',
        } satisfies SectionFtsRow,
        {
          meeting: {
            id: 'meet-1',
            title: 'Email Pipeline Sync',
            started_at: '2026-09-20T10:00:00Z',
            enhanced_notes:
              'Reviewed sandbox results. Unrelated USCIS certification planning.',
          } as dbModule.PersistedMeeting,
          section: {
            id: 1,
            meeting_id: 'meet-1',
            section_id: 'topic:client-email-automation',
            heading: 'Client Email Automation pipeline',
            kind: 'topic',
            summary: 'The sandbox passed and production deployment is next.',
            content:
              'The Client Email Automation pipeline completed sandbox testing and is preparing for production deployment.',
            entities_text: 'Client Email Automation pipeline',
            evidence_json: '[]',
            transcript_start_index: null,
            transcript_end_index: null,
            source_revision: 'revision-1',
            trust_status: 'grounded',
            updated_at: '2026-09-20T10:30:00Z',
          },
          snippet: 'Client Email Automation pipeline',
        } satisfies SectionFtsRow,
      ]);

      const recall = buildProjectRecall(
        'How is the Client Email Automation production rollout doing?',
      );
      expect(recall).not.toBeNull();
      expect(recall?.displayTitle).toBe('Client Email Automation');
      expect(recall?.context.length).toBeGreaterThan(0);

      const projectEvidence = recall?.context[0].evidence_text;
      expect(projectEvidence).toContain('[Project: Client Email Automation]');
      expect(projectEvidence).toContain(
        '[Desired Outcome]: Automate client email generation',
      );
      expect(projectEvidence).toContain(
        '[Current Focus]: Security compliance review',
      );
      expect(projectEvidence).toContain(
        '[Current Read]: Pipeline undergoing security review',
      );
      expect(projectEvidence).toContain('Beta deployment');
      expect(projectEvidence).toContain(
        'Preview rollout (past target: 2025-01-01; current completion not confirmed)',
      );
      expect(projectEvidence).toContain('Verify SMTP TLS');
      expect(projectEvidence).not.toContain('Recent Contributing Meetings');
      expect(recall?.context[1].evidence_text).toContain(
        'preparing for production deployment',
      );
      expect(recall?.context[1].evidence_text).not.toContain('USCIS');
      expect(recall?.context[1].meeting_id).toBe('meet-1');
      expect(recall?.latestNoteAt).toBe('2026-09-20T10:00:00Z');
      expect(
        buildAgedProjectAnswer(
          'What changed most recently, and what should I do next?',
          recall!,
          new Date('2026-09-28T12:00:00Z'),
        ),
      ).toContain('wouldn’t assume an older target is still pending');
      expect(
        buildAgedProjectAnswer(
          'Give me the current read on Client Email Automation.',
          recall!,
          new Date('2026-09-28T12:00:00Z'),
        ),
      ).toContain('said: Security compliance review');
      const mixedSummaryRecall = {
        ...recall!,
        context: recall!.context.map((source, index) =>
          index === 1
            ? {
                ...source,
                retrieved_sections: source.retrieved_sections?.map(
                  (section) => ({
                    ...section,
                    summary:
                      'An unrelated initiative needs a review. The Client Email Automation pipeline is being prepared for release. Send the unrelated update tomorrow.',
                  }),
                ),
              }
            : source,
        ),
      };
      const agedFollowUp = buildAgedProjectAnswer(
        'What would you do first?',
        mixedSummaryRecall,
        new Date('2026-09-28T12:00:00Z'),
      );
      expect(agedFollowUp).toContain('confirm the release status');
      expect(agedFollowUp).toContain('Client Email Automation');
      expect(agedFollowUp).not.toContain('unrelated initiative');
      expect(agedFollowUp).not.toContain('unrelated update');
      expect(
        buildAgedProjectAnswer(
          'Tell me what we know versus what needs checking about the pipeline.',
          mixedSummaryRecall,
          new Date('2026-09-28T12:00:00Z'),
        ),
      ).toContain('The newest project information I found is from');
      expect(
        buildAgedProjectAnswer(
          'Tell me what we know versus what needs checking about the pipeline.',
          mixedSummaryRecall,
          new Date('2026-09-28T12:00:00Z'),
          'The Client Email Automation pipeline is being prepared for release.',
        ),
      ).toContain("I don't have a newer confirmed pipeline update");
      expect(
        buildAgedProjectAnswer(
          'Explain the pipeline architecture in detail.',
          recall!,
          new Date('2026-09-28T12:00:00Z'),
        ),
      ).toBeNull();
      expect(
        buildAgedProjectAnswer(
          'What do you mean by that?',
          recall!,
          new Date('2026-09-28T12:00:00Z'),
          '',
          true,
          'clarify',
        ),
      ).toContain("I wouldn't call that a live project status");
      expect(
        buildAgedProjectAnswer(
          'That does not sound current.',
          recall!,
          new Date('2026-09-28T12:00:00Z'),
          '',
          false,
          'challenge',
        ),
      ).toContain("You're right to question the freshness");
      expect(recall?.context).toHaveLength(2);
      expect(dbModule.searchMeetingContextSectionsFts).toHaveBeenCalledWith(
        expect.any(String),
        { limit: 40 },
      );
    });

    it('adds newer project-specific synthesized sections missing from an aging profile', () => {
      vi.mocked(dbModule.getEntitiesByType).mockReturnValue([
        {
          id: 'atlas-project',
          type: 'project',
          name: 'Project Atlas',
          metadata: JSON.stringify({ projectDisplayTitle: 'Project Atlas' }),
        } as any,
      ]);
      vi.mocked(dbModule.getProjectBrief).mockReturnValue(null);
      vi.mocked(dbModule.getEntity).mockReturnValue({
        id: 'atlas-project',
        status: 'active',
      } as any);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        source_doc_last_synthesized_at: '2025-01-01T00:00:00Z',
        trust_status: 'grounded',
        payload: { current_read: { headline: 'Old rollout plan' } },
      } as any);
      vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([
        {
          meeting: {
            id: 'fresh-release',
            title: 'Release review',
            started_at: '2026-09-26T10:00:00Z',
          },
          section: {
            section_id: 'topic-1',
            heading: 'Project Atlas pipeline',
            summary: 'The pipeline release is ready.',
            content: 'Project Atlas pipeline completed the release check.',
            kind: 'discussion',
            source_revision: 'fresh-revision',
            trust_status: 'grounded',
          },
        },
        {
          meeting: {
            id: 'side-mention',
            title: 'Unrelated review',
            started_at: '2026-09-27T10:00:00Z',
          },
          section: {
            section_id: 'topic-2',
            heading: 'Team introductions',
            summary: 'A separate workstream was discussed.',
            content: 'Project Atlas was briefly mentioned.',
            kind: 'discussion',
            source_revision: 'side-revision',
            trust_status: 'grounded',
          },
        },
        {
          meeting: {
            id: 'newer-project-update',
            title: 'Project review',
            started_at: '2026-09-27T12:00:00Z',
          },
          section: {
            section_id: 'topic-3',
            heading: 'Project Atlas ownership',
            summary: 'Project Atlas ownership was reviewed.',
            content: 'Project Atlas owners discussed the handoff.',
            kind: 'discussion',
            source_revision: 'newer-revision',
            trust_status: 'grounded',
          },
        },
      ] as any);

      const recall = buildProjectRecall(
        'What changed in the Project Atlas pipeline?',
      );

      expect(recall?.context).toHaveLength(2);
      expect(recall?.context[1].meeting_id).toBe('fresh-release');
      expect(recall?.latestNoteAt).toBe('2026-09-27T12:00:00Z');
      expect(recall?.context[1].evidence_text).toContain(
        '[Meeting date]: 2026-09-26T10:00:00Z',
      );
      expect(recall?.context[1].evidence_text).not.toContain(
        'Team introductions',
      );
      expect(dbModule.searchMeetingContextSectionsFts).toHaveBeenCalledWith(
        expect.any(String),
        { limit: 40 },
      );
    });

    it('matches projects by label or alias in metadata', () => {
      vi.mocked(dbModule.getEntitiesByType).mockReturnValue([
        {
          id: 'proj-alpha',
          name: 'apollo',
          type: 'project',
          metadata: JSON.stringify({
            projectDisplayTitle: 'Apollo Engine',
            labels: ['infra-core', 'q4-launch'],
            aliases: ['apollo-next'],
          }),
        } as any,
      ]);

      const matchByLabel = matchProjectEntity(
        'what is the status of infra-core?',
      );
      expect(matchByLabel).not.toBeNull();
      expect(matchByLabel?.displayTitle).toBe('Apollo Engine');

      const matchByAlias = matchProjectEntity('tell me about apollo-next');
      expect(matchByAlias).not.toBeNull();
      expect(matchByAlias?.displayTitle).toBe('Apollo Engine');
    });
  });

  describe('synthesized-only context', () => {
    it('does not send confidential synthesized sources into a general answer', () => {
      const source = (meeting_id: string, evidence_text: string) => ({
        meeting_id,
        mid: null,
        evidence_text,
        evidence_kind: 'note' as const,
        score: 1,
        score_breakdown: {
          fts_rank: 1,
          graph_proximity: 0,
          recency_decay: 1,
          mention_weight: 0,
        },
      });
      expect(
        containsConfidentialAside('Keep the personal matter confidential.'),
      ).toBe(true);
      expect(
        containsConfidentialAside('Review the privacy approval checklist.'),
      ).toBe(false);
      expect(
        enforceSynthesizedOnlyContext([
          source('private', 'Keep the personal matter confidential.'),
          source('work', 'Gamma is reviewing the deployment checklist.'),
        ]).map((result) => result.meeting_id),
      ).toEqual(['work']);
      expect(
        enforceSynthesizedOnlyContext([
          {
            ...source('structured-private', 'The release checklist is ready.'),
            mid: {
              decisions: [
                { description: 'Keep the personal matter confidential.' },
              ],
            } as any,
          },
        ]),
      ).toEqual([]);
    });

    it('drops transcript results and removes embedded transcript passages', () => {
      const safe = enforceSynthesizedOnlyContext([
        {
          meeting_id: 'note-1',
          mid: null,
          evidence_text: 'Synthesized meeting notes',
          evidence_kind: 'note',
          transcript_passages: [
            {
              quote: 'raw words',
              speaker: 'Speaker',
              start_segment_index: 0,
              end_segment_index: 0,
              source_revision: 'r1',
              trust_status: 'grounded',
            },
          ],
          score: 1,
          score_breakdown: {
            fts_rank: 1,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
        {
          meeting_id: 'transcript-1',
          mid: null,
          evidence_text: 'Raw transcript result',
          evidence_kind: 'transcript',
          score: 1,
          score_breakdown: {
            fts_rank: 1,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ]);

      expect(safe).toHaveLength(1);
      expect(safe[0]).toMatchObject({
        meeting_id: 'note-1',
        evidence_kind: 'note',
      });
      expect(safe[0].transcript_passages).toBeUndefined();
    });
  });

  describe('isPlanningOrPriorityQuery', () => {
    it('accurately identifies planning and priority queries', () => {
      expect(isPlanningOrPriorityQuery('what should i focus on?')).toBe(true);
      expect(isPlanningOrPriorityQuery('what should i be focusing on?')).toBe(
        true,
      );
      expect(isPlanningOrPriorityQuery('what should i work on today?')).toBe(
        true,
      );
      expect(isPlanningOrPriorityQuery('what are my priorities?')).toBe(true);
      expect(isPlanningOrPriorityQuery('what are my top priorities?')).toBe(
        true,
      );
      expect(isPlanningOrPriorityQuery("what's on my plate?")).toBe(true);
      expect(isPlanningOrPriorityQuery('what is on my plate?')).toBe(true);
      expect(
        isPlanningOrPriorityQuery('what am i supposed to be working on?'),
      ).toBe(true);
      expect(isPlanningOrPriorityQuery('where should i start?')).toBe(true);
      expect(isPlanningOrPriorityQuery('what to focus on')).toBe(true);
      expect(isPlanningOrPriorityQuery('next steps for me')).toBe(true);
      expect(isPlanningOrPriorityQuery('what are our priorities?')).toBe(true);
      expect(isPlanningOrPriorityQuery('workspace overview')).toBe(true);
      expect(
        isPlanningOrPriorityQuery('What do you think I should focus on?'),
      ).toBe(true);
    });

    it('does not classify topical or factual queries as planning queries', () => {
      expect(
        isPlanningOrPriorityQuery(
          'what was the focus of the meeting with Morgan?',
        ),
      ).toBe(false);
      expect(
        isPlanningOrPriorityQuery('what did we decide about pricing?'),
      ).toBe(false);
      expect(isPlanningOrPriorityQuery('who was in the Berlin meeting?')).toBe(
        false,
      );
    });

    it('keeps conversational follow-ups attached to a planning briefing', () => {
      expect(
        shouldUseWorkspaceIntelligence({
          query: 'tell me more please?',
          relation: 'expansion',
          priorQuestion: 'what should i focus on?',
          conversationAnchor: 'what should i focus on?',
        }),
      ).toBe(true);
      expect(
        shouldUseWorkspaceIntelligence({
          query: 'what did you leave out? the stale items?',
          relation: 'follow_up',
          conversationAnchor: 'what should i focus on?',
        }),
      ).toBe(true);
      expect(
        shouldUseWorkspaceIntelligence({
          query: 'what did we decide about pricing?',
          relation: 'new_topic',
          conversationAnchor: 'what should i focus on?',
        }),
      ).toBe(false);
      expect(
        shouldUseWorkspaceIntelligence({
          query: 'Anything I should be concerned about across my work?',
          relation: 'new_topic',
        }),
      ).toBe(true);
    });

    it('selects expanded and omitted workspace follow-up modes', () => {
      expect(
        resolveWorkspaceIntelligenceMode('tell me more', 'expansion'),
      ).toBe('expanded');
      expect(
        resolveWorkspaceIntelligenceMode(
          'what did you leave out? the stale items?',
          'follow_up',
        ),
      ).toBe('omitted');
      expect(
        resolveWorkspaceIntelligenceMode(
          'Anything I should be concerned about?',
          'new_topic',
        ),
      ).toBe('risks');
      expect(
        resolveWorkspaceIntelligenceMode(
          'Tell me more.',
          'expansion',
          'Anything I should be concerned about?',
        ),
      ).toBe('risks_expanded');
    });
  });

  describe('parseQuery with planning queries', () => {
    it('filters out planning framing words so FTS does not search for "focus"', async () => {
      const parsed = await parseQuery('what should i focus on?');
      expect(parsed.keywords).not.toContain('focus');
      expect(parsed.keywords).not.toContain('should');
      expect(parsed.keywords).toEqual([]);
      expect(parsed.intent).toBe('factual');
    });

    it('retains specific project tokens while filtering planning stopwords', async () => {
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([]);
      const parsed = await parseQuery(
        'what should i focus on for Project Apollo?',
      );
      const lowerKeywords = parsed.keywords.map((k) => k.toLowerCase());
      expect(lowerKeywords).not.toContain('focus');
      expect(lowerKeywords).toContain('apollo');
      expect(parsed.intent).toBe('factual');
    });
  });

  describe('buildWorkspaceIntelligenceRecall', () => {
    it('synthesizes working memory, personal commitments, and active projects', () => {
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(
        'self-id',
      );
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue({
        person: { id: 'self-id', name: 'Gamma' },
        isSelf: true,
        commitments: {
          open: [
            {
              id: 'c1',
              text: 'Finalize API auth token rotation',
              dueDate: 'Sep 30',
              evidence: 'Promised to complete in security standup',
            },
          ],
          completed: [],
          candidates: [
            {
              id: 'c2',
              text: 'Review frontend theme tokens',
            },
          ],
        },
        meetings: [],
        mergedPeople: [],
      } as any);

      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        id: 'global-wm',
        trust_status: 'grounded',
        freshness: 'fresh',
        source_doc_last_synthesized_at: '2026-09-25T18:00:00Z',
        payload: {
          current_read: {
            headline: 'Q4 core platform stabilization in progress',
            freshness: 'fresh',
            supporting_bullets: [
              'Zero downtime deployment pipeline verified',
              'Authentication latency dropped by 40ms',
            ],
          },
          active_streams: [
            {
              title: 'API Gateway Modernization',
              status: 'active',
              current_read: 'Finalizing staging validation',
              last_touched_at: '2026-09-25T12:00:00Z',
              evidence_quality: { freshness: 'fresh' },
            },
            {
              title: 'Legacy migration',
              status: 'active',
              current_read: 'Old migration planning',
              last_touched_at: '2026-05-01T12:00:00Z',
              evidence_quality: { freshness: 'stale' },
            },
          ],
          open_loops: [
            {
              title: 'OAuth grant edge case',
              summary: 'Unresolved error handling on expired refresh token',
              why_now: 'Blocker for client release',
              evidence_quality: {
                freshness: 'fresh',
                last_reinforced_at: '2026-09-24T12:00:00Z',
              },
            },
          ],
          risks_and_unknowns: [
            {
              title: 'Database connection pool saturation under spike',
              summary: 'Need stress test before GA',
              evidence_quality: {
                freshness: 'fresh',
                last_reinforced_at: '2026-09-23T12:00:00Z',
              },
            },
          ],
        },
      } as any);

      vi.mocked(dbModule.getProjectPortfolio).mockReturnValue([
        {
          id: 'proj-1',
          name: 'api_gateway',
          display_title: 'API Gateway v2',
          status: 'active',
          current_focus: 'Zero-trust migration',
          next_milestone: 'Staging sign-off',
          health_headline: 'On schedule',
          last_mentioned_at: '2026-09-24T15:00:00Z',
        } as any,
        {
          id: 'proj-old',
          name: 'legacy_migration',
          display_title: 'Legacy Migration',
          status: 'active',
          current_focus: 'Old migration planning',
          last_mentioned_at: '2026-05-01T15:00:00Z',
        } as any,
        {
          id: 'proj-empty',
          name: 'contextless_project',
          display_title: 'Contextless Project',
          status: 'active',
          last_mentioned_at: '2026-09-26T15:00:00Z',
        } as any,
      ]);

      const meetings: dbModule.PersistedMeeting[] = [
        {
          id: 'meet-1',
          title: 'Architecture Review',
          started_at: '2026-09-24T15:00:00Z',
          enhanced_notes:
            '[Summary]: Approved the token rotation plan.\n[Decisions]: Adopted HMAC signing for inter-service communication.',
          mid_json: JSON.stringify({
            title: 'Architecture Review',
            decisions: [
              {
                description:
                  'Adopted HMAC signing for inter-service communication',
              },
            ],
          }),
        } as any,
      ];

      const recall = buildWorkspaceIntelligenceRecall({
        query: 'what should i focus on?',
        persistedMeetings: meetings,
        selfPersonId: 'self-id',
        now: Date.parse('2026-09-26T12:00:00Z'),
      });

      expect(recall.context.length).toBeGreaterThan(0);
      expect(recall.summary.hasWorkingMemory).toBe(true);
      expect(recall.summary.hasOpenCommitments).toBe(true);
      expect(recall.summary.hasActiveProjects).toBe(true);
      expect(recall.summary.openCommitmentCount).toBe(1);
      expect(recall.summary.activeStreamCount).toBe(1);
      expect(recall.answer).toContain(
        'Here’s my read: **Q4 core platform stabilization in progress.**',
      );
      expect(recall.answer).toContain('**Focus now**');
      expect(recall.answer).toContain(
        '1. **Finalize API auth token rotation** — Complete by Sep 30 [Source 1]',
      );
      expect(recall.answer).toContain(
        '3. **API Gateway v2** — Zero-trust migration [Source 1]',
      );
      expect(recall.answer).toContain('**Keep an eye on**');
      expect(recall.answer).toContain(
        'Unconfirmed follow-up: Review frontend theme tokens [Source 1]',
      );
      expect(recall.answer).toContain(
        'The workspace synthesis was refreshed Sep 25.',
      );
      expect(recall.answer).not.toContain('Legacy Migration');
      expect(recall.answer).not.toContain('Contextless Project');

      const riskRecall = buildWorkspaceIntelligenceRecall({
        query: 'What risks should I watch across my work?',
        persistedMeetings: meetings,
        selfPersonId: 'self-id',
        now: Date.parse('2026-09-26T12:00:00Z'),
        mode: 'risks',
      });
      expect(riskRecall.answer).toContain('**Watch points**');
      expect(riskRecall.answer).toContain('OAuth grant edge case');
      expect(riskRecall.answer).toContain(
        'Database connection pool saturation',
      );
      expect(riskRecall.answer).not.toContain('**Focus now**');
      const expandedRiskRecall = buildWorkspaceIntelligenceRecall({
        query: 'Tell me more about those concerns.',
        persistedMeetings: meetings,
        selfPersonId: 'self-id',
        now: Date.parse('2026-09-26T12:00:00Z'),
        mode: 'risks_expanded',
      });
      expect(expandedRiskRecall.answer).toContain(
        'Why it was flagged: Blocker for client release.',
      );
      expect(expandedRiskRecall.answer).toContain(
        'whether each item remains open',
      );

      const primaryEvidence = recall.context[0].evidence_text;
      expect(primaryEvidence).toContain(
        '[Workspace Current Read]: Q4 core platform stabilization in progress',
      );
      expect(primaryEvidence).toContain(
        'Zero downtime deployment pipeline verified',
      );
      expect(primaryEvidence).toContain(
        'Stream "API Gateway Modernization" [Status: active]: Finalizing staging validation',
      );
      expect(primaryEvidence).toContain(
        'OAuth grant edge case: Unresolved error handling on expired refresh token (Attention: Blocker for client release)',
      );
      expect(primaryEvidence).toContain(
        'Finalize API auth token rotation (Due: Sep 30)',
      );
      expect(primaryEvidence).toContain('Review frontend theme tokens');
      expect(primaryEvidence).toContain('Project "API Gateway v2" [active]');
      expect(primaryEvidence).toContain('Current Focus: Zero-trust migration');
      expect(primaryEvidence).toContain('Meeting "Architecture Review"');
    });

    it('does not let a stale workspace headline outrank recent synthesized work', () => {
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(null);
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue(null);
      vi.mocked(dbModule.getProjectPortfolio).mockReturnValue([]);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        id: 'global-wm',
        trust_status: 'grounded',
        freshness: 'aging',
        source_doc_last_synthesized_at: '2026-09-26T08:00:00Z',
        payload: {
          current_read: {
            headline: 'Old quarterly planning theme',
            freshness: 'stale',
            supporting_bullets: [],
          },
          active_streams: [
            {
              title: 'Release readiness',
              current_read: 'Closing the final launch blockers',
              last_touched_at: '2026-09-26T07:00:00Z',
              evidence_quality: { freshness: 'fresh' },
            },
            {
              title: 'Retired migration',
              current_read: 'Historical migration planning',
              last_touched_at: '2026-05-01T07:00:00Z',
              evidence_quality: { freshness: 'stale' },
            },
          ],
          open_loops: [],
          risks_and_unknowns: [],
        },
      } as any);

      const recall = buildWorkspaceIntelligenceRecall({
        query: 'what should i focus on?',
        persistedMeetings: [],
        now: Date.parse('2026-09-26T12:00:00Z'),
      });

      expect(recall.answer).toContain(
        '1. **Release readiness** — Closing the final launch blockers [Source 1]',
      );
      expect(recall.answer).toContain(
        'Here’s where I’d put your attention right now.',
      );
      expect(recall.answer).not.toContain('Old quarterly planning theme');
      expect(recall.answer).not.toContain('Retired migration');
    });

    it('adds context without repeating the same synthesized update', () => {
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(null);
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue(null);
      vi.mocked(dbModule.getProjectPortfolio).mockReturnValue([]);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        id: 'global-wm',
        trust_status: 'grounded',
        freshness: 'fresh',
        source_doc_last_synthesized_at: '2026-09-25T08:00:00Z',
        payload: {
          current_read: {
            headline: 'Prepare the release',
            freshness: 'fresh',
            supporting_bullets: ['The launch checklist is nearly complete'],
          },
          active_streams: [],
          open_loops: [],
          risks_and_unknowns: [],
        },
      } as any);

      const recall = buildWorkspaceIntelligenceRecall({
        query: 'tell me more',
        persistedMeetings: [
          {
            id: 'new-note',
            title: 'Release review',
            started_at: '2026-09-26T18:00:00Z',
            enhanced_notes:
              '[Summary]: The final launch blocker is the signing check.',
          } as any,
          {
            id: 'private-aside',
            title: 'Personal check-in',
            started_at: '2026-09-26T19:00:00Z',
            enhanced_notes:
              '[Action items]: Keep the travel option confidential between us.',
          } as any,
        ],
        mode: 'expanded',
        now: Date.parse('2026-09-27T00:00:00Z'),
      });

      expect(recall.answer).toContain('**More context**');
      expect(recall.answer).toContain(
        'The launch checklist is nearly complete [Source 1]',
      );
      expect(recall.answer).not.toContain('**Recent updates**');
      expect(recall.context).toHaveLength(2);
      expect(recall.answer).not.toContain('travel option');
    });

    it('keeps conversational notes out of a recent-work priority overlay', () => {
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(null);
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue(null);
      vi.mocked(dbModule.getProjectPortfolio).mockReturnValue([]);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        id: 'global-wm',
        trust_status: 'grounded',
        freshness: 'fresh',
        source_doc_last_synthesized_at: '2026-09-25T08:00:00Z',
        payload: { active_streams: [], open_loops: [], risks_and_unknowns: [] },
      } as any);

      const recall = buildWorkspaceIntelligenceRecall({
        query: 'What should I focus on?',
        persistedMeetings: [
          {
            id: 'greeting',
            title: 'Introduction',
            started_at: '2026-09-27T18:00:00Z',
            enhanced_notes: '[Analysis]: Everyone exchanged greetings.',
          },
          {
            id: 'release',
            title: 'Release review',
            started_at: '2026-09-26T18:00:00Z',
            enhanced_notes: '[Analysis]: The release blocker needs a fix.',
          },
        ] as any,
        now: Date.parse('2026-09-28T00:00:00Z'),
      });

      expect(recall.answer).toContain('Release review');
      expect(recall.answer).not.toContain('Introduction');
      expect(recall.context).toHaveLength(2);
    });

    it('puts newer note updates ahead of standing priorities from an aging snapshot', () => {
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(null);
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue(null);
      vi.mocked(dbModule.getProjectPortfolio).mockReturnValue([]);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        id: 'global-wm',
        trust_status: 'grounded',
        freshness: 'aging',
        source_doc_last_synthesized_at: '2026-09-16T08:00:00Z',
        payload: {
          active_streams: [
            {
              title: 'Release readiness',
              current_read: 'Close the remaining release work',
              last_touched_at: '2026-09-16T08:00:00Z',
            },
          ],
          open_loops: [],
          risks_and_unknowns: [],
        },
      } as any);

      const recall = buildWorkspaceIntelligenceRecall({
        query: 'What should I focus on now?',
        persistedMeetings: [
          {
            id: 'new-note',
            title: 'Release review',
            started_at: '2026-09-25T18:00:00Z',
            enhanced_notes: '[Analysis]: The rollout blocker needs review.',
          },
        ] as any,
        now: Date.parse('2026-09-28T00:00:00Z'),
      });

      expect(recall.answer).toContain('**Standing priorities (as of Sep 16)**');
      expect(recall.answer.indexOf('**Recent updates**')).toBeLessThan(
        recall.answer.indexOf('**Standing priorities'),
      );
      expect(recall.answer).not.toContain('**Focus now**');
    });

    it('does not reformat the same priorities as if they were new detail', () => {
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(null);
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue(null);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        id: 'global-wm',
        trust_status: 'grounded',
        freshness: 'fresh',
        source_doc_last_synthesized_at: '2026-09-25T08:00:00Z',
        payload: {
          active_streams: [
            {
              title: 'Pipeline & Infrastructure',
              status: 'Watch',
              current_read: 'Resolve the production deployment failure',
              last_touched_at: '2026-09-26T09:00:00Z',
              evidence_quality: { freshness: 'fresh' },
            },
          ],
          open_loops: [],
          risks_and_unknowns: [],
        },
      } as any);
      vi.mocked(dbModule.getProjectPortfolio).mockReturnValue([
        {
          id: 'nct',
          name: 'project_atlas',
          display_title: 'Project Atlas',
          status: 'active',
          next_milestone: 'Production Release',
          last_mentioned_at: '2026-09-26T08:00:00Z',
        } as any,
        {
          id: 'pluto',
          name: 'pluto',
          display_title: 'Pluto',
          status: 'active',
          current_focus:
            'Pluto is an open-source project focused on AI-first project management.',
          last_mentioned_at: '2026-09-26T10:00:00Z',
        } as any,
      ]);

      const sharedInput = {
        persistedMeetings: [],
        now: Date.parse('2026-09-27T00:00:00Z'),
      };
      const summary = buildWorkspaceIntelligenceRecall({
        ...sharedInput,
        query: 'what should i focus on?',
      });
      const expanded = buildWorkspaceIntelligenceRecall({
        ...sharedInput,
        query: 'tell me more',
        mode: 'expanded',
      });

      expect(summary.answer).toContain(
        '1. **Pipeline & Infrastructure** — Resolve the production deployment failure',
      );
      expect(summary.answer).toContain(
        '2. **Project Atlas** — Production Release',
      );
      expect(expanded.answer).toContain(
        'I don’t have a more specific synthesized update',
      );
      expect(expanded.answer).not.toContain('**Pipeline & Infrastructure**');
      expect(expanded.answer).not.toContain('**Project Atlas**');
      expect(expanded.answer).not.toContain('Why now: Watch');
      expect(summary.answer).not.toContain('Pluto is an open-source project');
      expect(expanded.answer).not.toContain('Pluto is an open-source project');
    });

    it('truncates recent synthesized-note updates at a complete word', () => {
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(null);
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue(null);
      vi.mocked(dbModule.getProjectPortfolio).mockReturnValue([]);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        id: 'global-wm',
        trust_status: 'grounded',
        freshness: 'fresh',
        source_doc_last_synthesized_at: '2026-09-25T08:00:00Z',
        payload: {
          active_streams: [],
          open_loops: [],
          risks_and_unknowns: [],
        },
      } as any);
      const longUpdate = `${'Complete release planning context '.repeat(16)}unfinishedtail`;

      const recall = buildWorkspaceIntelligenceRecall({
        query: 'what should i focus on?',
        persistedMeetings: [
          {
            id: 'new-note',
            title: 'Planning review',
            started_at: '2026-09-26T18:00:00Z',
            enhanced_notes: `[Analysis]: ${longUpdate}`,
          } as any,
        ],
        now: Date.parse('2026-09-27T00:00:00Z'),
      });

      expect(recall.answer).toMatch(
        /Planning review — Complete release planning context .*… \[Source 2\]/,
      );
      expect(recall.answer).not.toContain('unfinishedtail');
    });

    it('answers stale-item follow-ups from the omitted workspace set', () => {
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(null);
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue(null);
      vi.mocked(dbModule.getProjectPortfolio).mockReturnValue([]);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        id: 'global-wm',
        trust_status: 'grounded',
        freshness: 'fresh',
        source_doc_last_synthesized_at: '2026-09-25T08:00:00Z',
        payload: {
          current_read: {
            headline: 'Prepare the release',
            freshness: 'fresh',
            supporting_bullets: [],
          },
          active_streams: [
            {
              title: 'Retired migration',
              current_read: 'Historical migration planning',
              last_touched_at: '2026-05-01T07:00:00Z',
              evidence_quality: { freshness: 'stale' },
            },
          ],
          open_loops: [],
          risks_and_unknowns: [],
        },
      } as any);

      const recall = buildWorkspaceIntelligenceRecall({
        query: 'what did you leave out? the stale items?',
        persistedMeetings: [],
        mode: 'omitted',
        now: Date.parse('2026-09-27T00:00:00Z'),
      });

      expect(recall.answer).toContain(
        'I left these older or stale signals out of the main priority list',
      );
      expect(recall.answer).toContain('**Left out as older or stale**');
      expect(recall.answer).toContain(
        'Retired migration — Historical migration planning (last reinforced May 1)',
      );
      expect(recall.answer).not.toContain('**Focus now**');
    });
  });
});
