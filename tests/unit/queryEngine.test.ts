import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbModule from '../../electron/db';
import {
  buildExtractiveTemporalSummary,
  mergeRetrievalResultsByMeeting,
  parseQuery,
  retrieveContext,
} from '../../electron/intelligence/queryEngine';
import * as factoryModule from '../../electron/llm/factory';
import type { LLMProvider, LLMSettings } from '../../electron/llm/provider';

type MockProvider = Pick<LLMProvider, 'classifyQueryIntent'>;
type EntitySearchRow = ReturnType<
  typeof dbModule.searchEntitiesWithMeetingContext
>[number];
type FtsRow = ReturnType<typeof dbModule.searchMeetingsFts>[number];
type GraphEntity = ReturnType<typeof dbModule.walkEntityGraph>[number];

vi.mock('../../electron/db', () => ({
  searchMeetingsFts: vi.fn(),
  searchEntitiesWithMeetingContext: vi.fn(),
  walkEntityGraph: vi.fn(),
  getTemporalMeetings: vi.fn(),
  getMeetingsForEntity: vi.fn().mockReturnValue([]),
  getMeeting: vi.fn(),
}));

vi.mock('../../electron/llm/factory', () => ({
  getAllSettings: vi.fn(),
  getProvider: vi.fn(),
}));

describe('Query Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    it('merges FTS search and graph walk seamlessly', async () => {
      const mockProvider = {
        classifyQueryIntent: vi.fn().mockResolvedValue('{"intent":"factual"}'),
      } satisfies MockProvider;
      vi.mocked(factoryModule.getProvider).mockResolvedValue(
        mockProvider as unknown as LLMProvider,
      );

      // Mock DB FTS
      vi.mocked(dbModule.searchMeetingsFts).mockReturnValue([
        {
          id: 'm1',
          snippet: 'some api stuff',
          started_at: '2026-01-01T00:00:00Z',
          title: 'Meeting 1',
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
  });
});
