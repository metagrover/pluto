import {
  searchMeetingsFts,
  searchEntitiesWithMeetingContext,
  walkEntityGraph,
} from '../db';

import type { ParsedQuery, RetrievalResult, MidFrontmatter } from './intelligenceTypes';

// We import the llm provider factory
import { getProvider, getAllSettings } from '../llm/factory';
import * as dbModule from '../db';
import { getSynonymExpansionPrompt } from './queryPrompts';

/**
 * Parses a query string to extract intent, entities and semantic bounds.
 */
export const parseQuery = async (text: string): Promise<ParsedQuery> => {
  const lowerText = text.toLowerCase();
  
  // Basic tokenization
  const tokens = text.split(/[\s,.;:!?]+/).filter((w) => w.length > 2);
  // Basic keyword extraction (exclude stopwords like "what", "is", "the", etc.)
  const stopwords = new Set(['what', 'is', 'the', 'of', 'in', 'on', 'where', 'when', 'how', 'why', 'did', 'does', 'do', 'a', 'an']);
  const keywords = tokens.filter((w) => !stopwords.has(w.toLowerCase()));

  // Entity extraction and temporal is simplified here,
  // could use LLM for accurate 0-shot parsing
  const entityMentions = searchEntitiesWithMeetingContext(text)
    .map((e) => e.id)
    .slice(0, 3); // top 3 entities

  let intent: ParsedQuery['intent'] = 'factual';
  if (lowerText.includes('when') || lowerText.includes('date') || lowerText.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})\b/)) {
    intent = 'temporal';
  }
  if (lowerText.includes('compare') || lowerText.includes('vs')) {
    intent = 'comparative';
  }

  return {
    keywords,
    expanded_keywords: [],
    entity_mentions: entityMentions,
    temporal_range: null,
    intent,
  };
};

/**
 * Uses LLM to expand synonyms within a token limit (~100 tokens).
 */
export const expandSynonyms = async (keywords: string[]): Promise<string[]> => {
  if (keywords.length === 0) return [];
  try {
    const prompt = getSynonymExpansionPrompt(keywords);
    const settings = await getAllSettings(dbModule);
    const provider = await getProvider(settings);
    
    // Provider signature: synthesizeKnowledgeDocument(prompt)
    const response = await provider.synthesizeKnowledgeDocument(prompt);
    
    return response
      .split(',')
      .map((k: string) => k.trim())
      .filter((k) => k.length > 0 && k.toLowerCase() !== 'and');
  } catch (error) {
    console.warn('[QueryEngine] Failed to expand synonyms:', error);
    return []; // Return empty on fallback to ensure robustness
  }
};

const calculateRecencyDecay = (dateStr: string | null | undefined): number => {
  if (!dateStr) return 0.5;
  const daysAgo = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
  return 1 / (1 + Math.max(0, daysAgo) * 0.1);
};

/**
 * Core Retrieval logic: Vectorless RAG
 */
export const retrieveContext = async (parsed: ParsedQuery): Promise<RetrievalResult[]> => {
  const startTime = Date.now();
  const TIME_BUDGET = 1000; // 1 second

  const resultsMap: Record<string, RetrievalResult> = {};
  
  // 1. Synonym Expansion
  parsed.expanded_keywords = await expandSynonyms(parsed.keywords);
  const allKeywords = [...parsed.keywords, ...parsed.expanded_keywords];
  const ftsQueryStr = allKeywords.map((k) => `"${k}"`).join(' OR ');

  // 2. FTS Search
  if (ftsQueryStr) {
    const meetings = searchMeetingsFts(ftsQueryStr, { limit: 20 });
    meetings.forEach((m, idx) => {
      // rank is an implicit SQLite FTS score, we mock it via idx if it's not exposed
      // Assuming return order is rank order
      const fts_rank = 1.0 / (idx + 1); 
      let mid: MidFrontmatter | null = null;
      try {
        const midJsonStr = (m as any).mid_json;
        if (typeof midJsonStr === 'string' && midJsonStr.trim()) {
          mid = JSON.parse(midJsonStr);
        }
      } catch (e) {
        // ignore JSON errors
      }

      resultsMap[m.id as string] = {
        meeting_id: m.id as string,
        mid,
        evidence_text: m.snippet || m.title,
        score: fts_rank * 0.4,
        score_breakdown: {
          fts_rank,
          graph_proximity: 0,
          recency_decay: calculateRecencyDecay(m.started_at),
          mention_weight: 0,
        },
      };
    });
  }

  // 3. Graph Walk (BFS 2-hop)
  let walkedEntityCount = 0;
  for (const entityId of parsed.entity_mentions) {
    if (Date.now() - startTime > TIME_BUDGET) break;
    
    const walkResults = walkEntityGraph(entityId, 2, { state: 'confirmed' });
    
    // Integrate walkResults scores into resultsMap (can be implemented later)
    walkedEntityCount += walkResults.length;
  }

  // Debug logging
  if (process.env.PLUTO_DEBUG_SCORING === '1') {
    console.log('[QueryEngine] Graph walk examined entities: ', walkedEntityCount);
  }

  // 4. Time filter processing
  // (Left out for MVP, as getTemporalMeetings takes range but isn't strictly required for MVP)

  // 5. Result Fusion
  const finalResults = Object.values(resultsMap).map((res) => {
    // Incorporate mention counts from entities if we cross-referenced
    // Final composite score calculation:
    res.score = 
      res.score_breakdown.fts_rank * 0.4 + 
      res.score_breakdown.graph_proximity * 0.3 + 
      res.score_breakdown.recency_decay * 0.2 + 
      res.score_breakdown.mention_weight * 0.1;
      
    return res;
  });

  // Sort descending by score and pick top K=10
  finalResults.sort((a, b) => b.score - a.score);
  
  if (process.env.PLUTO_DEBUG_SCORING === '1') {
    console.table(finalResults.map(r => ({
      MeetingID: r.meeting_id,
      Score: r.score.toFixed(3),
      FTS: r.score_breakdown.fts_rank.toFixed(3),
      Recency: r.score_breakdown.recency_decay.toFixed(3)
    })));
  }

  return finalResults.slice(0, 10);
};
