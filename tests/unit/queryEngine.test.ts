import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbModule from '../../electron/db';
import {
  buildAssigneeActionRecall,
  buildExtractiveTemporalSummary,
  buildMeetingRetrievalResult,
  buildProjectRecall,
  buildWorkingMemoryOverviewRecall,
  buildWorkspaceIntelligenceRecall,
  isPlanningOrPriorityQuery,
  isSelfReferentialQuery,
  matchProjectEntity,
  mergeRetrievalResultsByMeeting,
  parseAssigneeActionQuery,
  parseQuery,
  resolveExplicitMeetingScope,
  retrieveContext,
  shouldUsePreparedExtractiveAnswer,
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
    it('includes active local artifacts as first-class retrieval sources', async () => {
      const mockArtifact = {
        id: 'artifact-1',
        type: 'markdown' as const,
        title: 'Launch reference',
        captured_at: '2026-09-19T18:00:00.000Z',
        imported_at: '2026-09-20T18:00:00.000Z',
        original_path: '/tmp/launch-reference.md',
        content_hash: 'revision-1',
        extracted_text:
          'The Juniper launch uses a canary rollout before the Friday announcement.',
        metadata_json: '{}',
        source_quality: 'usable' as const,
        trust_status: 'grounded' as const,
        status: 'active' as const,
        created_at: '2026-09-20T18:00:00.000Z',
        updated_at: '2026-09-20T18:00:00.000Z',
        match_score: 1,
      };
      vi.mocked(dbModule.searchLocalArtifacts).mockReturnValue([mockArtifact]);
      vi.mocked(dbModule.searchLocalArtifactsFts).mockReturnValue([
        mockArtifact,
      ]);

      const result = await retrieveContext({
        keywords: ['Juniper', 'launch'],
        expanded_keywords: [],
        entity_mentions: [],
        temporal_range: null,
        intent: 'factual',
      });

      expect(result[0]).toMatchObject({
        meeting_id: 'artifact-1',
        meeting_title: 'Launch reference',
        source_type: 'artifact',
        source_id: 'artifact-1',
        evidence_kind: 'artifact',
        trust_status: 'grounded',
        source_revision: 'revision-1',
      });
      expect(result[0].evidence_text).toContain('canary rollout');

      vi.mocked(dbModule.searchLocalArtifacts).mockClear();
      vi.mocked(dbModule.searchLocalArtifactsFts).mockClear();
      const meetingScoped = await retrieveContext(
        {
          keywords: ['Juniper'],
          expanded_keywords: [],
          entity_mentions: [],
          temporal_range: null,
          intent: 'factual',
        },
        { meetingIds: ['meeting-1'] },
      );
      expect(meetingScoped).not.toContainEqual(
        expect.objectContaining({ source_type: 'artifact' }),
      );
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

    it('deepens a matching section into bounded timestamped transcript passages', async () => {
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
      vi.mocked(dbModule.getMeeting).mockReturnValue(meeting);
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

      expect(result[0].evidence_kind).toBe('transcript');
      expect(result[0].transcript_passages?.[0]).toMatchObject({
        start_ms: 40000,
        start_segment_index: 0,
        end_segment_index: 2,
      });
      expect(result[0].transcript_passages?.[0].quote).toContain(
        'The release moves to Friday.',
      );
      expect(result[0].transcript_passages?.[0].quote).not.toContain(
        'Unrelated budget topic',
      );
    });

    it('strictly omits transcript passages when synthesizedOnly is enabled', async () => {
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
      vi.mocked(dbModule.getMeeting).mockReturnValue(meeting);
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
          query: 'Quote exactly why the release moved to Friday.',
          synthesizedOnly: true,
        },
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
      vi.mocked(dbModule.getMeeting).mockReturnValue(meeting);
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
              assignee: 'Ayush',
              due_date: '2026-09-03',
              status: 'active',
            },
            {
              entity_id: 'action-2',
              description: 'Archive the old launch checklist.',
              assignee: 'Ayush',
              status: 'completed',
            },
            {
              entity_id: 'action-3',
              description: 'Send the updated launch plan to the team.',
              assignee: 'Ayush',
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
              assignee: 'ayush',
              status: 'active',
            },
          ],
        }),
      },
    ] as dbModule.PersistedMeeting[];

    it('answers the exact generated assignee suggestion from structured intelligence', () => {
      const recall = buildAssigneeActionRecall(
        "What's assigned to Ayush?",
        meetings,
      );

      expect(recall).not.toBeNull();
      expect(recall?.assignee).toBe('Ayush');
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
      expect(buildAssigneeActionRecall('What does Ayush own?', meetings)).not
        .toBeNull;
      expect(
        buildAssigneeActionRecall("What are Ayush's action items?", meetings),
      ).not.toBeNull;
      expect(
        buildAssigneeActionRecall('What did Ayush say about launch?', meetings),
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
      const recall = buildAssigneeActionRecall("What's assigned to Ayush?", [
        meetings[0],
        {
          id: 'other-ayush-meeting',
          title: 'Partner follow-up',
          enhanced_notes:
            'Ayush discussed several next steps, but the saved notes do not name an owner.',
        } as dbModule.PersistedMeeting,
      ]);

      expect(recall).toMatchObject({
        coverageLimited: true,
        mentionedMeetingCount: 2,
      });
      expect(recall?.context).toHaveLength(1);
    });

    it('resolves “me” through the confirmed self identity and canonical commitments', () => {
      const self = { id: 'person-self', name: 'Punit', type: 'person' };
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(
        self.id,
      );
      vi.mocked(dbModule.getEntity).mockImplementation((id) =>
        id === self.id
          ? (self as ReturnType<typeof dbModule.getEntity>)
          : undefined,
      );
      vi.mocked(dbModule.getMeeting).mockReturnValue(meetings[0]);
      vi.mocked(dbModule.getCanonicalPersonCommitments).mockReturnValue({
        open: [
          {
            id: 'commitment-1',
            text: 'Send the revised launch plan.',
            status: 'open',
            dueDate: '2026-09-03',
            sourceMeetingId: 'planning',
            sourceKind: 'mid',
            evidence: 'Punit will send the revised launch plan.',
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
            suggestedOwnerName: 'Punit',
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
        name: 'Punit',
        type: 'person',
      } as any);
      vi.mocked(dbModule.getMeeting).mockReturnValue(meetings[0]);
      vi.mocked(dbModule.getCanonicalPersonCommitments).mockReturnValue({
        open: [
          {
            id: 'commitment-nodate',
            text: 'Cloud deployment setup.',
            status: 'open',
            dueDate: null,
            sourceMeetingId: 'planning',
            sourceKind: 'mid',
            evidence: 'Punit will set up cloud deployment.',
          },
          {
            id: 'commitment-urgent',
            text: 'Finish the hardened pipeline for Mary.',
            status: 'open',
            dueDate: '2026-09-02',
            sourceMeetingId: 'planning',
            sourceKind: 'mid',
            evidence: 'Punit committed to finishing the hardened pipeline.',
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
        recall?.answer.indexOf('Finish the hardened pipeline for Mary') ?? -1;
      const nodateIndex =
        recall?.answer.indexOf('Cloud deployment setup') ?? -1;
      expect(urgentIndex).toBeGreaterThan(-1);
      expect(nodateIndex).toBeGreaterThan(-1);
      expect(urgentIndex).toBeLessThan(nodateIndex);
    });
  });

  describe('buildWorkingMemoryOverviewRecall', () => {
    it('uses working-memory citations as navigation to meeting evidence', () => {
      const meeting = {
        id: 'overview-meeting',
        title: 'Company planning',
        started_at: '2026-09-01T10:00:00.000Z',
      } as dbModule.PersistedMeeting;
      vi.mocked(dbModule.getMeeting).mockReturnValue(meeting);
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
        ],
        tasks: [
          {
            id: 't1',
            name: 'Verify SMTP TLS',
            status: 'open',
            assigned_to: 'Ayush',
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
      vi.mocked(dbModule.getMeeting).mockReturnValue({
        id: 'meet-1',
        title: 'Email Pipeline Sync',
        started_at: '2026-09-20T10:00:00Z',
        enhanced_notes: 'Reviewed sandbox results.',
      } as any);

      const recall = buildProjectRecall(
        'How is the Client Email Automation project doing?',
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
      expect(projectEvidence).toContain('Verify SMTP TLS');
      expect(projectEvidence).toContain('Email Pipeline Sync');
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
    });

    it('does not classify topical or factual queries as planning queries', () => {
      expect(
        isPlanningOrPriorityQuery(
          'what was the focus of the meeting with Cody?',
        ),
      ).toBe(false);
      expect(
        isPlanningOrPriorityQuery('what did we decide about pricing?'),
      ).toBe(false);
      expect(isPlanningOrPriorityQuery('who was in the Berlin meeting?')).toBe(
        false,
      );
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
        person: { id: 'self-id', name: 'Ayush' },
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
        payload: {
          current_read: {
            headline: 'Q4 core platform stabilization in progress',
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
            },
          ],
          open_loops: [
            {
              title: 'OAuth grant edge case',
              summary: 'Unresolved error handling on expired refresh token',
              why_now: 'Blocker for client release',
            },
          ],
          risks_and_unknowns: [
            {
              title: 'Database connection pool saturation under spike',
              summary: 'Need stress test before GA',
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
      });

      expect(recall.context.length).toBeGreaterThan(0);
      expect(recall.summary.hasWorkingMemory).toBe(true);
      expect(recall.summary.hasOpenCommitments).toBe(true);
      expect(recall.summary.hasActiveProjects).toBe(true);
      expect(recall.summary.openCommitmentCount).toBe(1);
      expect(recall.summary.activeStreamCount).toBe(1);

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
  });
});
