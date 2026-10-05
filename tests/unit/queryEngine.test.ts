import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbModule from '../../electron/db';
import {
  applyAssigneeCommitmentState,
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
  getAskPlutoMeetingHeaders: vi.fn().mockReturnValue([]),
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
    vi.mocked(dbModule.getAskPlutoMeetingHeaders).mockReturnValue([]);
    vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(undefined);
    vi.mocked(dbModule.getMeetingsForEntity).mockReturnValue([]);
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

    it('excludes function words and request framing from deterministic topic searches', async () => {
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([]);
      const result = await parseQuery(
        'What are the concrete next steps for the Orion work and release testing, who is actually named, and which dates are confirmed versus conditional?',
        { useModelClassification: false },
      );
      expect(result.keywords).toEqual([
        'Orion',
        'release',
        'testing',
        'named',
        'dates',
        'confirmed',
        'conditional',
      ]);
      const entityQuery = vi
        .mocked(dbModule.searchEntitiesWithMeetingContext)
        .mock.calls.at(-1)?.[0];
      expect(entityQuery).not.toMatch(
        /"(?:and|who|which|work|steps|actually|concrete|versus)"/,
      );
      await retrieveContext(result);
      expect(dbModule.searchMeetingNotesFts).toHaveBeenCalledWith(
        '"orion" OR "release" OR "testing" OR "named" OR "dates" OR "confirmed" OR "conditional"',
        { limit: 20 },
      );
      expect(factoryModule.getProvider).not.toHaveBeenCalled();
    });

    it('keeps preparation requests focused on their substantive topics', async () => {
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([]);
      const result = await parseQuery(
        'Help me prepare a focused Orion session. Clarify what is still open and what to carry into the room.',
        { useModelClassification: false },
      );
      expect(result.keywords).toEqual(['Orion', 'open']);
      const review = await parseQuery(
        'What do Orion notes say carefully, and whether we can conclude approval?',
        { useModelClassification: false },
      );
      expect(review.keywords).toEqual(['Orion', 'approval']);
    });

    it('deduplicates requested keywords case-insensitively without losing substantive words', async () => {
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([]);
      const result = await parseQuery(
        'Compare Orion and ORION testing with testing dates',
        { useModelClassification: false },
      );
      expect(
        result.keywords.filter((word) => word.toLowerCase() === 'orion'),
      ).toEqual(['Orion']);
      expect(result.keywords.filter((word) => word === 'testing')).toEqual([
        'testing',
      ]);
      expect(result.keywords).toContain('dates');
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

      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue({
        id: 'm1',
        title: 'Meeting 1',
        started_at: '2026-01-01T00:00:00Z',
        enhanced_notes: 'GraphQL was selected for the API.',
      } as dbModule.PersistedMeeting);

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
        enhanced_notes: 'The release moved to Friday after final QA.',
      } as dbModule.PersistedMeeting;
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(meeting);
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
        evidence_kind: 'note',
        retrieved_sections: [
          { section_id: 'meeting-notes', heading: 'Meeting notes' },
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
        enhanced_notes: 'The release moved to Friday after final QA.',
      } as dbModule.PersistedMeeting;
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(meeting);
      meeting.analysis_json = JSON.stringify({
        analysis_schema_version: 3,
        overview: 'The review covered release readiness.',
        topics: [
          {
            title: 'Release timing',
            summary: 'The release checklist is ready for review.',
            key_points: [],
            decisions: [],
            action_items: [],
            open_questions: [],
          },
          {
            title: 'Personal aside',
            summary: 'Keep this discussion confidential between us.',
            key_points: [],
            decisions: [],
            action_items: [],
            open_questions: [],
          },
        ],
        all_decisions: [],
        all_action_items: [],
        meeting_type: 'general',
        quality: {
          format_pass: true,
          retry_count: 0,
          fallback_used: false,
          issues: [],
        },
      });
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
      ).toEqual(expect.arrayContaining(['topic-0']));
      expect(result[0].evidence_text).not.toContain('confidential');
    });

    it('keeps note-only matches visible while the section index is partially backfilled', async () => {
      const sectionMeeting = {
        id: 'section-meeting',
        title: 'Launch review',
        started_at: '2026-09-01T10:00:00.000Z',
        enhanced_notes: 'The release moved to Friday after final QA.',
      } as dbModule.PersistedMeeting;
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(sectionMeeting);
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
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        id === 'section-meeting' ? sectionMeeting : noteOnlyMeeting,
      );

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

    it('hydrates selected notes completely and reflects corrections instead of cached index text', async () => {
      const indexed = {
        id: 'current',
        title: 'Old title',
        enhanced_notes: 'Obsolete approval.',
        started_at: '2026-09-01T00:00:00Z',
      } as FtsRow;
      vi.mocked(dbModule.searchMeetingNotesFts).mockReturnValue([indexed]);
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue({
        ...indexed,
        title: 'Current title',
        analysis_format_pass: 0,
        enhanced_notes: `Release review. ${'Supporting context. '.repeat(500)} Morgan owns testing; the date follows review.`,
        mid_json: JSON.stringify({
          decisions: [{ description: 'STALE_MID_APPROVAL' }],
        }),
        transcript_json: 'PRIVATE_TRANSCRIPT',
      } as dbModule.PersistedMeeting);
      const result = await retrieveContext({
        keywords: ['release'],
        entity_mentions: [],
        temporal_range: null,
        intent: 'factual',
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        meeting_title: 'Current title',
        mid: null,
        evidence_kind: 'note',
        trust_status: 'needs_review',
      });
      expect(result[0].evidence_text.replace(/\s+/g, ' ')).toContain(
        'Morgan owns testing; the date follows review.',
      );
      expect(result[0].evidence_text).toContain('[Text omitted]');
      expect(result[0].evidence_text.length).toBeLessThan(8500);
      expect(result[0].evidence_text).not.toMatch(
        /Obsolete approval|STALE_MID_APPROVAL|PRIVATE_TRANSCRIPT/,
      );
      expect(result[0].source_revision).toHaveLength(64);
    });

    it('discovers a rarer requested topic beyond a crowded global result window', async () => {
      const common = Array.from(
        { length: 20 },
        (_, index) =>
          ({
            id: `common-${index}`,
            title: 'Orion work',
            started_at: '2026-09-20T00:00:00Z',
            enhanced_notes: 'Orion implementation remains underway.',
          }) as FtsRow,
      );
      const weekly = {
        id: 'weekly',
        title: 'Weekly review',
        started_at: '2026-09-25T00:00:00Z',
        enhanced_notes:
          'Orion priorities were reviewed. Customer-events testing starts after owner review.',
      } as FtsRow;
      vi.mocked(dbModule.searchMeetingNotesFts).mockImplementation((query) =>
        query === '"customer"* AND "events"*' ? [weekly] : common,
      );
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        id === weekly.id ? weekly : common.find((meeting) => meeting.id === id),
      );
      const result = await retrieveContext({
        keywords: ['Orion', 'customer-events', 'testing'],
        entity_mentions: [],
        temporal_range: null,
        intent: 'factual',
      });
      expect(result[0].meeting_id).toBe('weekly');
      expect(result[0].evidence_text).toContain(
        'testing starts after owner review',
      );
      expect(result).toHaveLength(12);
      expect(dbModule.searchMeetingNotesFts).toHaveBeenCalledWith(
        '"customer"* AND "events"*',
        { limit: 40 },
      );
    });

    it('retains short recent updates buried behind historical facet ranks', async () => {
      const historical = Array.from(
        { length: 39 },
        (_, index) =>
          ({
            id: `history-${index}`,
            title: 'Profile history',
            started_at: '2020-08-01T00:00:00Z',
            enhanced_notes:
              'Profiles were reviewed in a long historical process.',
          }) as FtsRow,
      );
      const newest = {
        id: 'recent-counts',
        title: 'Weekly review',
        started_at: '2020-09-25T00:00:00Z',
        enhanced_notes:
          'Fifteen profiles were inspected; six clients are viable.',
      } as FtsRow;
      vi.mocked(dbModule.searchMeetingNotesFts).mockImplementation((query) =>
        query.includes(' OR ')
          ? historical.slice(0, 20)
          : [...historical, newest],
      );
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        id === newest.id
          ? newest
          : historical.find((meeting) => meeting.id === id),
      );
      const result = await retrieveContext({
        keywords: ['profile', 'client'],
        entity_mentions: [],
        temporal_range: null,
        intent: 'factual',
      });
      expect(result[0].meeting_id).toBe('recent-counts');
      expect(result[0].evidence_text).toContain(
        'Fifteen profiles were inspected; six clients are viable.',
      );
      const recent = await retrieveContext(
        {
          keywords: ['profile', 'client'],
          entity_mentions: [],
          temporal_range: null,
          intent: 'factual',
        },
        { query: 'Compare recent profiles and clients' },
      );
      expect(recent.map((source) => source.meeting_id)).toEqual([
        'recent-counts',
      ]);
      const explicit = await retrieveContext({
        keywords: ['profile', 'client'],
        entity_mentions: [],
        temporal_range: {
          from: '2020-09-20T00:00:00Z',
          to: '2020-09-30T00:00:00Z',
        },
        intent: 'factual',
      });
      expect(explicit.map((source) => source.meeting_id)).toEqual([
        'recent-counts',
      ]);
    });

    it('uses prefix discovery and current topic coverage while honoring meeting restrictions', async () => {
      const eligible = {
        id: 'eligible',
        title: 'Weekly review',
        started_at: '2026-09-25T00:00:00Z',
        enhanced_notes:
          'Fifteen profiles were checked; six are viable clients.',
      } as FtsRow;
      const excluded = {
        id: 'excluded',
        title: 'Profiles and clients',
        enhanced_notes: 'Unrelated private customer result.',
      } as FtsRow;
      vi.mocked(dbModule.searchMeetingNotesFts).mockReturnValue([
        excluded,
        eligible,
      ]);
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        id === eligible.id ? eligible : excluded,
      );
      const result = await retrieveContext(
        {
          keywords: ['profile', 'client'],
          entity_mentions: [],
          temporal_range: null,
          intent: 'factual',
        },
        { meetingIds: ['eligible'] },
      );
      expect(result.map((item) => item.meeting_id)).toEqual(['eligible']);
      expect(result[0].score_breakdown.fts_rank).toBe(1);
      expect(dbModule.searchMeetingNotesFts).toHaveBeenCalledWith(
        '"profile"*',
        { limit: 40, meetingIds: ['eligible'] },
      );
      expect(dbModule.getAskPlutoMeeting).not.toHaveBeenCalledWith('excluded');
    });

    it('discovers renamed current titles and ranks them above incidental note mentions', async () => {
      const renamed = {
        id: 'renamed',
        title: 'Orion version review',
        started_at: '2026-10-01T00:00:00Z',
        enhanced_notes:
          'The team chose version three; the portal dependency remains open.',
      } as FtsRow;
      const incidental = {
        id: 'incidental',
        title: 'Unrelated implementation review',
        started_at: '2026-09-01T00:00:00Z',
        enhanced_notes: 'Orion was mentioned in passing.',
      } as FtsRow;
      vi.mocked(dbModule.searchMeetingNotesFts).mockReturnValue([incidental]);
      vi.mocked(dbModule.getAskPlutoMeetingHeaders).mockReturnValue([renamed]);
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        id === 'renamed' ? renamed : incidental,
      );
      const result = await retrieveContext({
        keywords: ['Orion'],
        entity_mentions: [],
        temporal_range: null,
        intent: 'factual',
      });
      expect(result[0]).toMatchObject({
        meeting_id: 'renamed',
        meeting_title: 'Orion version review',
        evidence_kind: 'note',
      });
      expect(result[0].evidence_text).toContain('The team chose version three');
      const restricted = await retrieveContext(
        {
          keywords: ['Orion'],
          entity_mentions: [],
          temporal_range: null,
          intent: 'factual',
        },
        { meetingIds: ['incidental'] },
      );
      expect(restricted.map((item) => item.meeting_id)).toEqual(['incidental']);
    });

    it('limits recent questions to fourteen days ending at the newest available source', async () => {
      const old = {
        id: 'old-profile',
        title: 'Profile review',
        started_at: '2020-08-01T00:00:00Z',
        enhanced_notes: 'Old profiles were reviewed.',
      } as FtsRow;
      const newest = {
        id: 'new-profile',
        title: 'Profile review',
        started_at: '2020-09-25T00:00:00Z',
        enhanced_notes: 'Newest profiles were reviewed.',
      } as FtsRow;
      vi.mocked(dbModule.searchMeetingNotesFts).mockReturnValue([old, newest]);
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        id === old.id ? old : newest,
      );
      const parsed = {
        keywords: ['profile'],
        entity_mentions: [],
        temporal_range: null,
        intent: 'factual' as const,
      };
      const recent = await retrieveContext(parsed, {
        query: 'Compare recent profiles',
      });
      expect(recent.map((source) => source.meeting_id)).toEqual([
        'new-profile',
      ]);
      const explicit = await retrieveContext(parsed, {
        query: 'Compare recent profiles with 2020-08-01',
      });
      expect(explicit.map((source) => source.meeting_id)).toEqual(
        expect.arrayContaining(['old-profile', 'new-profile']),
      );
      const pinned = buildMeetingRetrievalResult(old);
      const withPinned = await retrieveContext(parsed, {
        query: 'Compare recent profiles',
        pinnedResults: [pinned],
      });
      expect(withPinned.map((source) => source.meeting_id)).toEqual([
        'old-profile',
        'new-profile',
      ]);
    });

    it('bounds current-title discovery to twenty newest matching headers', async () => {
      const meetings = Array.from(
        { length: 30 },
        (_, index) =>
          ({
            id: `title-${index}`,
            title: 'Orion review',
            started_at: new Date(2026, 8, index + 1).toISOString(),
            enhanced_notes: 'The review remains open.',
          }) as FtsRow,
      );
      vi.mocked(dbModule.getAskPlutoMeetingHeaders).mockReturnValue(meetings);
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        meetings.find((meeting) => meeting.id === id),
      );
      await retrieveContext({
        keywords: ['Orion'],
        entity_mentions: [],
        temporal_range: null,
        intent: 'factual',
      });
      expect(dbModule.getAskPlutoMeeting).toHaveBeenCalledTimes(20);
      expect(dbModule.getAskPlutoMeeting).not.toHaveBeenCalledWith('title-0');
      expect(dbModule.getAskPlutoMeeting).toHaveBeenCalledWith('title-29');
    });

    it('bounds facet searches and current-note hydration with oversized keyword input', async () => {
      const meetings = Array.from(
        { length: 120 },
        (_, index) =>
          ({
            id: `bounded-${index}`,
            title: 'Review',
            enhanced_notes: 'topic profiles',
          }) as FtsRow,
      );
      vi.mocked(dbModule.searchMeetingNotesFts).mockReturnValue(meetings);
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        meetings.find((meeting) => meeting.id === id),
      );
      await retrieveContext({
        keywords: Array.from({ length: 40 }, (_, index) => `topic${index}`),
        entity_mentions: [],
        temporal_range: null,
        intent: 'factual',
      });
      expect(dbModule.searchMeetingNotesFts).toHaveBeenCalledTimes(13);
      expect(dbModule.getAskPlutoMeeting).toHaveBeenCalledTimes(80);
    });

    it('does not resurrect deleted or empty sources from the notes index', async () => {
      vi.mocked(dbModule.searchMeetingNotesFts).mockReturnValue([
        { id: 'deleted', enhanced_notes: 'Old release approval.' },
        { id: 'empty', enhanced_notes: 'Old release owner.' },
      ] as FtsRow[]);
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        id === 'empty'
          ? ({
              id,
              title: 'Empty notes',
              enhanced_notes: '',
            } as dbModule.PersistedMeeting)
          : undefined,
      );
      expect(
        await retrieveContext({
          keywords: ['release'],
          entity_mentions: [],
          temporal_range: null,
          intent: 'factual',
        }),
      ).toEqual([]);
    });

    it('preserves deliberately scoped pinned evidence instead of expanding its meeting', async () => {
      const pinned = buildMeetingRetrievalResult({
        id: 'pinned',
        title: 'Scoped meeting',
        enhanced_notes: 'Project Orion scoped detail.',
      } as dbModule.PersistedMeeting);
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue({
        id: 'pinned',
        enhanced_notes: 'Unrelated workstream secret.',
      } as dbModule.PersistedMeeting);
      const result = await retrieveContext(
        {
          keywords: [],
          entity_mentions: [],
          temporal_range: null,
          intent: 'factual',
        },
        { pinnedResults: [pinned] },
      );
      expect(result).toEqual([pinned]);
      expect(dbModule.getAskPlutoMeeting).not.toHaveBeenCalled();
    });

    it('never deepens matching note sections into raw transcript passages', async () => {
      const meeting = {
        id: 'transcript-meeting',
        title: 'Release review',
        started_at: '2026-09-01T10:00:00.000Z',
        enhanced_notes: 'The release moved to Friday after final QA.',
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

      expect(result[0].evidence_kind).toBe('note');
      expect(result[0].transcript_passages).toBeUndefined();
      expect(result[0].evidence_text).not.toContain('Final QA is complete');
      expect(dbModule.searchMeetingsFts).not.toHaveBeenCalled();
    });

    it('uses synthesized notes even when exact wording is requested', async () => {
      const meeting = {
        id: 'transcript-meeting',
        title: 'Release review',
        started_at: '2026-09-01T10:00:00.000Z',
        enhanced_notes: 'The release moved to Friday after final QA.',
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

      expect(result[0].evidence_kind).toBe('note');
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
        enhanced_notes: 'The release moved to Friday after final QA.',
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

      expect(result[0].evidence_kind).toBe('note');
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

    it('searches beyond an empty canonical list for a known person mentioned in notes', () => {
      vi.mocked(dbModule.findEntity).mockReturnValue({
        id: 'person-c',
        name: 'Gamma',
        type: 'person',
      } as dbModule.Entity);
      const recall = buildAssigneeActionRecall(
        "What's assigned to Gamma?",
        meetings,
      );
      expect(recall).toMatchObject({
        coverageLimited: true,
        mentionedMeetingCount: 2,
        commitmentCount: 0,
      });
      // Saved assignments must be retrieved as evidence, not promoted past review.
      expect(recall?.context).toEqual([]);
    });

    it('keeps completed canonical work closed while detecting other uncovered notes', () => {
      vi.mocked(dbModule.findEntity).mockReturnValue({
        id: 'person-c',
        name: 'Gamma',
        type: 'person',
      } as dbModule.Entity);
      vi.mocked(dbModule.getCanonicalPersonCommitments).mockReturnValue({
        open: [],
        candidates: [],
        delivered: [
          {
            id: 'closed',
            text: 'Send the revised launch plan.',
            status: 'completed',
            dueDate: null,
            sourceMeetingId: 'planning',
            sourceKind: 'mid',
            evidence: null,
          },
        ],
      });
      expect(
        buildAssigneeActionRecall("What's assigned to Gamma?", [meetings[0]]),
      ).toMatchObject({ coverageLimited: true, commitmentCount: 0 });
      expect(
        buildAssigneeActionRecall("What's assigned to Gamma?", meetings),
      ).toMatchObject({ coverageLimited: true, commitmentCount: 0 });
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

    it('prefers a literal project name over duplicate display aliases regardless of row order', () => {
      const alias = {
        id: 'delivery-project',
        type: 'project',
        name: 'Orion Delivery',
        metadata: JSON.stringify({ projectDisplayTitle: 'Orion' }),
      };
      const literal = {
        id: 'orion-project',
        type: 'project',
        name: 'Orion',
        metadata: JSON.stringify({ projectDisplayTitle: 'Orion' }),
      };
      vi.mocked(dbModule.resolveProjectIdentityId).mockImplementation(
        (id) => id,
      );
      for (const projects of [
        [alias, literal],
        [literal, alias],
      ]) {
        vi.mocked(dbModule.getEntitiesByType).mockReturnValue(projects as any);
        expect(matchProjectEntity('Review Orion')).toMatchObject({
          id: 'orion-project',
          canonicalId: 'orion-project',
          name: 'Orion',
          matchKind: 'explicit_label',
        });
        expect(matchProjectEntity('Review Orion Delivery')).toMatchObject({
          id: 'delivery-project',
          name: 'Orion Delivery',
        });
        expect(matchProjectEntity('Review Project Nebula')).toBeNull();
      }
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

    it('retrieves complete current notes from stable project titles without inferred aliases or question facet words', () => {
      const project = {
        id: 'orion-project',
        type: 'project',
        name: 'Project Orion',
        metadata: JSON.stringify({
          projectDisplayTitle: 'ORB Launchpad',
          aliases: ['Orbital Employee Portal'],
        }),
      };
      vi.mocked(dbModule.getEntitiesByType).mockReturnValue([project] as any);
      vi.mocked(dbModule.resolveProjectIdentityId).mockImplementation(
        (id) => id,
      );
      vi.mocked(dbModule.getEntity).mockReturnValue(project as any);
      vi.mocked(dbModule.getProjectBrief).mockReturnValue(null);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        source_doc_last_synthesized_at: '2025-01-01T00:00:00Z',
        trust_status: 'grounded',
        payload: {
          current_read: {
            headline: 'Separate calendar testing determines the launch date.',
            supporting_bullets: [],
          },
        },
      } as any);
      const notes = Array.from({ length: 10 }, (_, index) => ({
        id: `orb-${index}`,
        title:
          index === 9 ? 'Orbital Employee Portal scope' : `ORB design ${index}`,
        started_at: new Date(
          Date.parse('2026-09-27T00:00:00Z') + index * 60 * 60 * 1000,
        ).toISOString(),
        enhanced_notes: `${'Guided employee onboarding supports account conversations. '.repeat(70)}\nMorgan will determine the final date after platform access is confirmed.`,
        transcript_json: 'PRIVATE_TRANSCRIPT_SENTINEL',
      }));
      vi.mocked(dbModule.getAskPlutoMeetingHeaders).mockReturnValue(
        notes as any,
      );
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation(
        (id) => notes.find((meeting) => meeting.id === id) as any,
      );
      const recall = buildProjectRecall(
        'Give me a detailed ORB Launchpad deep dive: ownership, deadlines, boundaries, and what remains uncertain.',
      );
      expect(recall?.context).toHaveLength(8);
      expect(recall?.context.map((source) => source.meeting_id)).toEqual([
        'orb-8',
        'orb-7',
        'orb-6',
        'orb-5',
        'orb-4',
        'orb-3',
        'orb-2',
        'orb-1',
      ]);
      expect(recall?.context[0].evidence_text).toContain(
        notes[8].enhanced_notes,
      );
      expect(recall?.context[0].evidence_text).toContain(
        'Morgan will determine the final date after platform access is confirmed.',
      );
      expect(recall?.context[0].mid).toBeNull();
      expect(recall?.context[0].source_revision).toMatch(/^[a-f0-9]{64}$/);
      expect(recall?.latestNoteAt).toBe(notes[8].started_at);
      expect(JSON.stringify(recall?.context)).not.toContain(
        'PRIVATE_TRANSCRIPT_SENTINEL',
      );
      expect(JSON.stringify(recall?.context)).not.toContain(
        'Separate calendar testing',
      );
      expect(dbModule.getMeeting).not.toHaveBeenCalled();
    });

    it('keeps explicit project identity when canonical reconciliation points at another project', () => {
      const matched = { id: 'ctx-project', name: 'CTX', type: 'project' };
      const canonical = {
        id: 'orion-project',
        name: 'Project Orion',
        type: 'project',
        metadata: JSON.stringify({ aliases: ['Orion'] }),
      };
      vi.mocked(dbModule.getEntitiesByType).mockReturnValue([matched] as any);
      vi.mocked(dbModule.resolveProjectIdentityId).mockReturnValue(
        'orion-project',
      );
      vi.mocked(dbModule.getEntity).mockReturnValue(canonical as any);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue(null);
      vi.mocked(dbModule.getProjectBrief).mockReturnValue({
        project: {
          displayTitle: 'Project Orion',
          detectedTitle: 'Orion',
          metadata: JSON.stringify({ aliases: ['Orion'] }),
        },
        meetings: [],
      } as any);
      const older = {
        id: 'ctx-old',
        title: 'CTX review',
        started_at: '2020-08-01T00:00:00Z',
        enhanced_notes: 'Old cohort has ten clients.',
      };
      const current = {
        id: 'ctx-current',
        title: 'CTX profile review',
        started_at: '2020-09-25T00:00:00Z',
        enhanced_notes: 'Current cohort has five clients.',
      };
      const unrelated = {
        id: 'orion-current',
        title: 'Project Orion kickoff',
        started_at: '2020-10-01T00:00:00Z',
        enhanced_notes: 'Orion portal release is approved.',
      };
      vi.mocked(dbModule.getMeetingsForEntity).mockReturnValue([
        { meeting_id: unrelated.id, mention_count: 1, context: null },
      ]);
      vi.mocked(dbModule.getAskPlutoMeetingHeaders).mockReturnValue([
        older,
        current,
        unrelated,
      ]);
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        [older, current, unrelated].find((meeting) => meeting.id === id),
      );
      const recall = buildProjectRecall('Compare recent CTX client profiles');
      expect(recall?.displayTitle).toBe('CTX');
      expect(recall?.context.map((source) => source.meeting_id)).toEqual([
        'ctx-current',
      ]);
      expect(JSON.stringify(recall?.context)).not.toMatch(/Orion|ten clients/);
      vi.mocked(dbModule.getAskPlutoMeetingHeaders).mockReturnValue([]);
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(undefined);
      expect(buildProjectRecall('Describe CTX')?.context).toEqual([]);
    });

    it('rehydrates linked mixed meetings and excludes obsolete indexed claims, removals, and unrelated sections', () => {
      const project = {
        id: 'orion-project',
        type: 'project',
        name: 'Project Orion',
        metadata: JSON.stringify({
          labels: [
            'Weekly portfolio conversation',
            'Separate customer portfolio',
          ],
        }),
      };
      vi.mocked(dbModule.getEntitiesByType).mockReturnValue([project] as any);
      vi.mocked(dbModule.resolveProjectIdentityId).mockImplementation(
        (id) => id,
      );
      vi.mocked(dbModule.getEntity).mockReturnValue(project as any);
      vi.mocked(dbModule.getProjectBrief).mockReturnValue(null);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue(null);
      vi.mocked(dbModule.getMeetingsForEntity).mockReturnValue([
        { meeting_id: 'mixed', mention_count: 1, context: null },
        { meeting_id: 'deleted', mention_count: 1, context: null },
        { meeting_id: 'private', mention_count: 1, context: null },
      ]);
      const meeting = {
        id: 'mixed',
        title: 'Weekly portfolio conversation',
        started_at: '2026-09-27T18:00:00Z',
        analysis_format_pass: 0,
        enhanced_notes: 'Obsolete Project Orion launch date is confirmed.',
        analysis_json: JSON.stringify({
          analysis_schema_version: 3,
          overview: 'Project Orion ownership remains unassigned.',
          topics: [
            {
              title: 'Customer readiness',
              summary:
                'Project Orion profile review is underway. Fifteen profiles were inspected; six are viable.',
              key_points: [],
              decisions: [],
              action_items: [],
              open_questions: [],
            },
            {
              title: 'Separate customer portfolio',
              summary: 'Unrelated vendor contract is approved.',
              key_points: [],
              decisions: [],
              action_items: [],
              open_questions: [],
            },
          ],
          all_decisions: [{ text: 'Project Orion launch date is confirmed.' }],
          all_action_items: [],
          meeting_type: 'general',
          quality: {
            format_pass: true,
            retry_count: 0,
            fallback_used: false,
            issues: [],
          },
        }),
        user_edits_json: JSON.stringify({
          overview: {
            original: 'Project Orion ownership remains unassigned.',
            edited:
              'Project Orion ownership is with Morgan; the final date is not confirmed.',
            edited_at: '2026-09-28T00:00:00Z',
          },
          'all_decisions:0': {
            original: 'Project Orion launch date is confirmed.',
            edited: '',
            edited_at: '2026-09-28T00:00:00Z',
          },
        }),
        mid_json: JSON.stringify({
          decisions: [
            { description: 'Obsolete Project Orion launch date is confirmed.' },
          ],
        }),
        transcript_json: 'PRIVATE_TRANSCRIPT_SENTINEL',
      };
      vi.mocked(dbModule.getAskPlutoMeetingHeaders).mockReturnValue([
        meeting,
        {
          id: 'deleted',
          title: 'Project Orion deleted',
          started_at: '2026-09-28T00:00:00Z',
        },
        {
          id: 'private',
          title: 'Project Orion personal check-in',
          started_at: '2026-09-28T01:00:00Z',
        },
      ] as any);
      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        id === 'mixed'
          ? (meeting as any)
          : id === 'private'
            ? {
                id,
                title: 'Project Orion personal check-in',
                enhanced_notes:
                  'Keep the travel option confidential between us.',
              }
            : undefined,
      );
      vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([
        {
          meeting: {
            id: 'mixed',
            title: 'Weekly portfolio conversation',
            started_at: meeting.started_at,
          },
          section: {
            heading: 'Project Orion launch',
            summary: 'Project Orion launch date is confirmed.',
            content: 'Project Orion launch date is confirmed.',
            source_revision: 'stale-index-revision',
          },
        },
      ] as any);
      const recall = buildProjectRecall(
        'Who owns the next Project Orion steps and which dates are confirmed?',
      );
      expect(recall?.context).toHaveLength(1);
      expect(recall?.context[0]).toMatchObject({
        meeting_id: 'mixed',
        trust_status: 'needs_review',
        mid: null,
      });
      expect(recall?.context[0].evidence_text).toContain(
        'Project Orion ownership is with Morgan; the final date is not confirmed.',
      );
      expect(recall?.context[0].evidence_text).toContain(
        'Fifteen profiles were inspected; six are viable.',
      );
      expect(JSON.stringify(recall?.context)).not.toMatch(
        /Obsolete|remains unassigned|vendor contract|launch date is confirmed|PRIVATE_TRANSCRIPT|stale-index-revision/,
      );
      expect(
        recall?.context[0].retrieved_sections?.every(
          (section) =>
            section.source_revision === recall.context[0].source_revision,
        ),
      ).toBe(true);
      expect(dbModule.getMeeting).not.toHaveBeenCalled();
    });

    it('does not trust an indexed project section when current notes no longer concern the project', () => {
      const project = {
        id: 'orion-project',
        type: 'project',
        name: 'Project Orion',
      };
      vi.mocked(dbModule.getEntitiesByType).mockReturnValue([project] as any);
      vi.mocked(dbModule.resolveProjectIdentityId).mockImplementation(
        (id) => id,
      );
      vi.mocked(dbModule.getEntity).mockReturnValue(project as any);
      vi.mocked(dbModule.getProjectBrief).mockReturnValue(null);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue(null);
      vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([
        {
          meeting: {
            id: 'removed-topic',
            title: 'Team review',
            started_at: '2026-09-27T18:00:00Z',
          },
          section: {
            heading: 'Project Orion ownership',
            summary: 'Project Orion was assigned to Morgan.',
            content: 'Old indexed assignment.',
          },
        },
      ] as any);
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue({
        id: 'removed-topic',
        title: 'Team review',
        enhanced_notes: 'Only the separate customer portfolio was discussed.',
      });
      const recall = buildProjectRecall(
        'What is the current Project Orion ownership?',
      );
      expect(recall?.context).toHaveLength(1);
      expect(recall?.latestNoteAt).toBeUndefined();
      expect(JSON.stringify(recall?.context)).not.toContain(
        'assigned to Morgan',
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

      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        id === 'meet-1'
          ? {
              id: 'meet-1',
              title: 'Email Pipeline Sync',
              started_at: '2026-09-20T10:00:00Z',
              enhanced_notes:
                'The Client Email Automation pipeline completed sandbox testing and is preparing for production deployment. Unrelated USCIS certification planning.',
            }
          : id === 'meet-old'
            ? {
                id: 'meet-old',
                title: 'Older Email Pipeline Sync',
                started_at: '2026-08-20T10:00:00Z',
                enhanced_notes: 'Discussed the initial pilot.',
              }
            : undefined,
      );
      const recall = buildProjectRecall(
        'How is the Client Email Automation production rollout doing?',
      );
      expect(recall).not.toBeNull();
      expect(recall?.displayTitle).toBe('Client Email Automation');
      expect(recall?.context.length).toBeGreaterThan(0);

      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(undefined);
      const fallback = buildProjectRecall(
        'How is the Client Email Automation production rollout doing?',
      );
      const projectEvidence = fallback?.context[0].evidence_text;
      expect(fallback?.context[0].source_type).toBe('artifact');
      expect(
        recall?.context.every((source) => source.source_type !== 'artifact'),
      ).toBe(true);
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
      expect(recall?.context[0].evidence_text).toContain(
        'preparing for production deployment',
      );
      expect(recall?.context[0].evidence_text).not.toContain('USCIS');
      expect(recall?.context[0].meeting_id).toBe('meet-1');
      expect(recall?.latestNoteAt).toBe('2026-09-20T10:00:00Z');
      expect(recall?.context).toHaveLength(1);
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

      vi.mocked(dbModule.getAskPlutoMeeting).mockImplementation((id) =>
        id === 'fresh-release'
          ? {
              id,
              title: 'Release review',
              started_at: '2026-09-26T10:00:00Z',
              enhanced_notes:
                'Project Atlas pipeline completed the release check.',
            }
          : id === 'newer-project-update'
            ? {
                id,
                title: 'Project review',
                started_at: '2026-09-27T12:00:00Z',
                enhanced_notes: 'Project Atlas owners discussed the handoff.',
              }
            : undefined,
      );
      const recall = buildProjectRecall(
        'What changed in the Project Atlas pipeline?',
      );

      expect(recall?.context).toHaveLength(2);
      expect(recall?.context[0].meeting_id).toBe('newer-project-update');
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
    it('includes newer saved notes without priority keywords and preserves later topic evidence', () => {
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(null);
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue(null);
      vi.mocked(dbModule.getProjectPortfolio).mockReturnValue([]);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue({
        freshness: 'stale',
        source_doc_last_synthesized_at: '2026-09-01T08:00:00Z',
        payload: {
          current_read: { headline: 'Old standing focus', freshness: 'stale' },
          active_streams: [],
          open_loops: [],
          risks_and_unknowns: [],
        },
      } as any);
      const recall = buildWorkspaceIntelligenceRecall({
        query: 'What needs my attention across my work?',
        now: Date.parse('2026-09-28T00:00:00Z'),
        persistedMeetings: [
          {
            id: 'new-account',
            title: 'Customer conversation',
            started_at: '2026-09-27T18:00:00Z',
            enhanced_notes: 'People exchanged greetings.',
            analysis_json: JSON.stringify({
              analysis_schema_version: 3,
              overview: 'People exchanged greetings. '.repeat(160),
              topics: [
                {
                  title: 'Account ownership',
                  summary:
                    'Customer conversations now sit with the Horizon team.',
                  key_points: [],
                  decisions: [],
                  action_items: [],
                  open_questions: [],
                },
              ],
              all_decisions: [],
              all_action_items: [],
              meeting_type: 'general',
              quality: {
                format_pass: true,
                retry_count: 0,
                fallback_used: false,
                issues: [],
              },
            }),
            transcript_json: 'PRIVATE_TRANSCRIPT_SENTINEL',
          } as any,
        ],
      });
      expect(recall.summary.recentMeetingCount).toBe(1);
      expect(recall.context[1].evidence_text).toContain(
        'Customer conversations now sit with the Horizon team.',
      );
      expect(recall.context[1].evidence_text).toContain('[Account ownership]');
      expect(recall.context[0].evidence_text).toContain(
        '[Workspace refreshed]: 2026-09-01',
      );
      expect(recall.context[0].evidence_text).toContain(
        '[Workspace snapshot freshness]: stale',
      );
      expect(recall.context[0].evidence_text).toContain(
        'Current saved notes supersede older workspace descriptions',
      );
      expect(JSON.stringify(recall.context)).not.toContain(
        'PRIVATE_TRANSCRIPT_SENTINEL',
      );
      expect(recall.context[1].evidence_text.length).toBeLessThan(5000);
    });

    it('uses current note edits and removals while preserving review trust and excluding stale MID claims', () => {
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(null);
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue(null);
      vi.mocked(dbModule.getProjectPortfolio).mockReturnValue([]);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue(null);
      const recall = buildWorkspaceIntelligenceRecall({
        query: 'What should I focus on?',
        now: Date.parse('2026-09-28T00:00:00Z'),
        persistedMeetings: [
          {
            id: 'edited-account',
            title: 'Account conversation',
            started_at: '2026-09-27T18:00:00Z',
            enhanced_notes: 'Obsolete account wording.',
            analysis_format_pass: 0,
            analysis_json: JSON.stringify({
              analysis_schema_version: 3,
              overview: 'Obsolete account wording.',
              topics: [],
              all_decisions: [{ text: 'Obsolete budget remains confirmed.' }],
              all_action_items: [],
              meeting_type: 'general',
              quality: {
                format_pass: true,
                retry_count: 0,
                fallback_used: false,
                issues: [],
              },
            }),
            user_edits_json: JSON.stringify({
              overview: {
                original: 'Obsolete account wording.',
                edited: 'Customer conversations now sit with the Horizon team.',
                edited_at: '2026-09-27T20:00:00Z',
              },
              'all_decisions:0': {
                original: 'Obsolete budget remains confirmed.',
                edited: '',
                edited_at: '2026-09-27T20:00:00Z',
              },
            }),
            mid_json: JSON.stringify({
              decisions: [
                { description: 'Obsolete budget remains confirmed.' },
              ],
            }),
            transcript_json: 'PRIVATE_TRANSCRIPT_SENTINEL',
          } as any,
        ],
      });
      const result = recall.context[1];
      expect(result.trust_status).toBe('needs_review');
      expect(result.mid).toBeNull();
      expect(result.source_revision).toMatch(/^[a-f0-9]{64}$/);
      expect(result.evidence_text).toContain(
        'Customer conversations now sit with the Horizon team.',
      );
      expect(result.evidence_text).toContain('[Notes trust]: needs_review');
      expect(JSON.stringify(recall.context)).not.toContain('Obsolete');
      expect(JSON.stringify(recall.context)).not.toContain(
        'PRIVATE_TRANSCRIPT_SENTINEL',
      );
    });

    it('bounds broad recent-note coverage by recency while retaining sources without MID or matching words', () => {
      vi.mocked(dbModule.identityStore.getSelfPersonId).mockReturnValue(null);
      vi.mocked(dbModule.getPersonBriefing).mockReturnValue(null);
      vi.mocked(dbModule.getProjectPortfolio).mockReturnValue([]);
      vi.mocked(dbModule.getWorkingMemorySnapshot).mockReturnValue(null);
      const meetings = Array.from({ length: 12 }, (_, index) => ({
        id: `recent-${index}`,
        title: `Customer conversation ${index}`,
        started_at: new Date(
          Date.parse('2026-09-27T00:00:00Z') + index * 60 * 60 * 1000,
        ).toISOString(),
        enhanced_notes: `Customer account ${index} now belongs to the Horizon team.`,
      }));
      const recall = buildWorkspaceIntelligenceRecall({
        query: 'What concerns should I watch?',
        mode: 'risks',
        now: Date.parse('2026-09-28T00:00:00Z'),
        persistedMeetings: [
          ...meetings,
          {
            id: 'old',
            title: 'Older note',
            started_at: '2026-08-01T00:00:00Z',
            enhanced_notes: 'Older account context.',
          },
        ] as any,
      });
      expect(recall.summary.recentMeetingCount).toBe(8);
      expect(recall.context).toHaveLength(9);
      expect(
        recall.context.slice(1).map((result) => result.meeting_id),
      ).toEqual([
        'recent-11',
        'recent-10',
        'recent-9',
        'recent-8',
        'recent-7',
        'recent-6',
        'recent-5',
        'recent-4',
      ]);
      expect(recall.context[0].evidence_text).toContain(
        'newest 8 usable meetings within 14 days',
      );
    });

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

    it('keeps recent conversational notes available alongside work notes for model reasoning', () => {
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
      expect(recall.context[1].evidence_text).toContain(
        'Everyone exchanged greetings.',
      );
      expect(recall.context[2].evidence_text).toContain(
        'The release blocker needs a fix.',
      );
      expect(recall.context).toHaveLength(3);
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
      const longUpdate = `${'Complete release planning context '.repeat(64)}unfinishedtail`;

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

  describe('Ask Pluto assignment and long-note recovery', () => {
    it('does not mistake one completed task for complete coverage of its source', () => {
      vi.mocked(dbModule.findEntity).mockReturnValue({
        id: 'person-m',
        name: 'Morgan',
        type: 'person',
      } as dbModule.Entity);
      const meeting = {
        id: 'same-source',
        title: 'Review',
        enhanced_notes:
          'Morgan archived the checklist. Morgan agreed to send the acceptance report.',
      } as dbModule.PersistedMeeting;
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(meeting);
      vi.mocked(dbModule.getCanonicalPersonCommitments).mockReturnValue({
        open: [],
        candidates: [],
        delivered: [
          {
            id: 'closed',
            text: 'Archive the checklist.',
            status: 'completed',
            dueDate: null,
            sourceMeetingId: 'same-source',
            evidence: null,
          },
        ],
      } as any);
      const recall = buildAssigneeActionRecall("What's assigned to Morgan?", [
        meeting,
      ]);
      expect(recall).toMatchObject({
        coverageLimited: true,
        commitmentCount: 0,
      });
      expect(
        applyAssigneeCommitmentState(
          [buildMeetingRetrievalResult(meeting)],
          recall,
        )[0].evidence_text,
      ).toContain('acceptance report');
      expect(
        applyAssigneeCommitmentState(
          [buildMeetingRetrievalResult(meeting)],
          recall,
        )[0].evidence_text,
      ).toContain('Morgan — completed: Archive the checklist.');
      expect(recall?.answer).not.toContain('- Archive');
    });
    it('selects relevant middle evidence before long-note budgeting', async () => {
      const meeting = {
        id: 'long',
        title: 'Review',
        enhanced_notes: `${'General planning update. '.repeat(230)}\nMorgan owns the acceptance report.\n${'Routine engineering update. '.repeat(230)}`,
      } as dbModule.PersistedMeeting;
      vi.mocked(dbModule.searchMeetingNotesFts).mockReturnValue([
        meeting,
      ] as any);
      vi.mocked(dbModule.getAskPlutoMeeting).mockReturnValue(meeting);
      vi.mocked(dbModule.searchMeetingContextSectionsFts).mockReturnValue([]);
      vi.mocked(dbModule.getAskPlutoMeetingHeaders).mockReturnValue([]);
      vi.mocked(dbModule.walkEntityGraph).mockReturnValue([]);
      vi.mocked(dbModule.getEntitiesByType).mockReturnValue([]);
      const results = await retrieveContext(
        {
          intent: 'factual',
          keywords: ['Morgan'],
          entity_mentions: [],
          temporal_range: null,
        },
        { query: "What's assigned to Morgan?" },
      );
      expect(results[0].evidence_text).toContain(
        'Morgan owns the acceptance report.',
      );
      expect(results[0].evidence_text.length).toBeLessThan(8500);
    });
  });
});

it('retains matching middle evidence when rebuilding a prior cited source for retry', () => {
  const meeting = {
    id: 'prior',
    title: 'Review',
    enhanced_notes: `${'Routine planning. '.repeat(300)}\nMorgan owns the acceptance report.\n${'Routine implementation. '.repeat(300)}`,
  } as dbModule.PersistedMeeting;
  const result = buildMeetingRetrievalResult(
    meeting,
    'Prior cited meeting',
    "What's assigned to Morgan?",
  );
  expect(result.evidence_text).toContain('Morgan owns the acceptance report.');
  expect(result.evidence_text.length).toBeLessThan(2400);
});
