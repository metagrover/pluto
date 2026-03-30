import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseQuery, expandSynonyms, retrieveContext } from '../../electron/intelligence/queryEngine';
import * as dbModule from '../../electron/db';
import * as factoryModule from '../../electron/llm/factory';

vi.mock('../../electron/db', () => ({
  searchMeetingsFts: vi.fn(),
  searchEntitiesWithMeetingContext: vi.fn(),
  walkEntityGraph: vi.fn(),
  getTemporalMeetings: vi.fn(),
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
      
      const result = await parseQuery('What dates did we discuss the backend migration?');
      expect(result.intent).toBe('temporal');
      // Should filter out "what", "did", "we", "the"
      expect(result.keywords).toContain('dates');
      expect(result.keywords).toContain('discuss');
      expect(result.keywords).toContain('backend');
      expect(result.keywords).toContain('migration');
    });

    it('extracts entity mentions from DB mock', async () => {
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([
        { id: '123', name: 'GraphQL', type: 'topic', mention_count: 5, context: '', meeting_id: 'm1' }
      ] as any);
      
      const result = await parseQuery('Tell me about GraphQL');
      expect(result.entity_mentions).toContain('123');
    });
  });

  describe('expandSynonyms', () => {
    it('uses the LLM to expand synonyms', async () => {
      const mockProvider = {
        synthesizeKnowledgeDocument: vi.fn().mockResolvedValue('API, backend, frontend'),
      };
      vi.mocked(factoryModule.getProvider).mockResolvedValue(mockProvider as any);
      vi.mocked(factoryModule.getAllSettings).mockResolvedValue({} as any);

      const result = await expandSynonyms(['GraphQL']);
      expect(result).toEqual(['API', 'backend', 'frontend']);
      expect(mockProvider.synthesizeKnowledgeDocument).toHaveBeenCalled();
    });

    it('handles LLM failures gracefully', async () => {
      const mockProvider = {
        synthesizeKnowledgeDocument: vi.fn().mockRejectedValue(new Error('Out of quota')),
      };
      vi.mocked(factoryModule.getProvider).mockResolvedValue(mockProvider as any);
      vi.mocked(factoryModule.getAllSettings).mockResolvedValue({} as any);

      const result = await expandSynonyms(['GraphQL']);
      expect(result).toEqual([]);
    });
  });

  describe('retrieveContext', () => {
    it('merges FTS search and graph walk seamlessly', async () => {
      // Mock LLM expansion
      const mockProvider = {
        synthesizeKnowledgeDocument: vi.fn().mockResolvedValue('API'),
      };
      vi.mocked(factoryModule.getProvider).mockResolvedValue(mockProvider as any);
      
      // Mock DB FTS
      vi.mocked(dbModule.searchMeetingsFts).mockReturnValue([
        { id: 'm1', snippet: 'some api stuff', started_at: '2026-01-01T00:00:00Z', title: 'Meeting 1' } as any
      ]);
      
      // Mock DB Entity resolution & Walk
      vi.mocked(dbModule.searchEntitiesWithMeetingContext).mockReturnValue([{ id: 'e1' } as any]);
      vi.mocked(dbModule.walkEntityGraph).mockReturnValue([
        { id: 'e2', name: 'Frontend', type: 'topic' } as any
      ]);

      const result = await retrieveContext({
        keywords: ['graphql'],
        expanded_keywords: [],
        entity_mentions: ['e1'],
        temporal_range: null,
        intent: 'factual'
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].meeting_id).toBe('m1');
      expect(result[0].score).toBeGreaterThan(0);
    });
  });
});
